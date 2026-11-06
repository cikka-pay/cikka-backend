import { prisma } from "../config/prisma";
import { isRazorpayStubMode } from "../config/env";
import { Prisma } from "../generated/prisma/client";
import {
  razorpayService,
  hasRazorpayCredentials,
  RazorpayPaymentEntity,
  STUB_PAYMENT_PREFIX,
} from "./razorpay.service";

export type CheckoutPurpose = "MALL" | "REWARDS";
export type FulfilmentChannel = "VERIFY" | "CARD_OTP" | "WEBHOOK";

export type RazorpayCheckoutRow = NonNullable<Awaited<ReturnType<typeof prisma.razorpayCheckout.findUnique>>>;

/** A payment that failed server-side verification. `status` is the HTTP status to answer with. */
export class PaymentVerificationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "PaymentVerificationError";
  }
}

export interface ConfirmedPayment {
  payment: RazorpayPaymentEntity;
  checkout: RazorpayCheckoutRow | null;
  /** Amount actually captured, in paise, as reported by Razorpay. Never the client's number. */
  amountPaise: number;
}

export type FulfilmentOutcome =
  | { state: "FULFILLED"; result: any }
  | { state: "DUPLICATE"; result: any }
  | { state: "IN_PROGRESS"; result: null };

const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

export const razorpayCheckoutService = {
  /**
   * Create a Razorpay order and record it with the cart/shipping snapshot, so the order can be
   * fulfilled later from the webhook even if the app never calls verify.
   */
  async createCheckout(input: {
    purpose: CheckoutPurpose;
    amountPaise: number;
    currency?: string;
    receipt?: string;
    notes?: Record<string, string>;
    userId?: string | null;
    snapshot?: Record<string, unknown>;
  }) {
    const order = await razorpayService.createOrder({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt,
      notes: { ...(input.notes || {}), checkout_purpose: input.purpose },
    });

    const checkout = await prisma.razorpayCheckout.create({
      data: {
        razorpayOrderId: order.order_id,
        purpose: input.purpose,
        userId: input.userId || null,
        amountPaise: order.amount,
        currency: order.currency || "INR",
        snapshot: toJson(input.snapshot || {}),
      },
    });

    return { order, checkout };
  },

  findByOrderId(razorpayOrderId: string) {
    return prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId } });
  },

  /**
   * Confirm with Razorpay that `paymentId` is a captured payment for `orderId` for the full
   * order amount (GET /v1/payments/:id; capture it first if it is only `authorized`).
   * Throws PaymentVerificationError otherwise.
   */
  async confirmCapturedPayment(params: {
    orderId: string;
    paymentId: string;
    purpose: CheckoutPurpose;
  }): Promise<ConfirmedPayment> {
    const { orderId, paymentId, purpose } = params;
    const checkout = await this.findByOrderId(orderId);

    if (checkout && checkout.purpose !== purpose) {
      throw new PaymentVerificationError(400, "WRONG_CHECKOUT", "This payment belongs to a different checkout.");
    }

    // Stub mode: payments minted by our own fake card flow (or any payment when no keys are
    // configured) are treated as captured for the amount we recorded at order creation.
    if (isRazorpayStubMode() && (paymentId.startsWith(STUB_PAYMENT_PREFIX) || !hasRazorpayCredentials())) {
      if (!checkout) {
        throw new PaymentVerificationError(404, "UNKNOWN_ORDER", "Unknown Razorpay order.");
      }
      const payment: RazorpayPaymentEntity = {
        id: paymentId,
        order_id: orderId,
        amount: checkout.amountPaise,
        currency: checkout.currency,
        status: "captured",
        captured: true,
      };
      return { payment, checkout, amountPaise: payment.amount };
    }

    let payment: RazorpayPaymentEntity;
    try {
      payment = await razorpayService.fetchPayment(paymentId);
    } catch (err: any) {
      throw new PaymentVerificationError(400, "PAYMENT_NOT_FOUND", "Payment could not be found with Razorpay.");
    }

    if (!payment || payment.id !== paymentId || payment.order_id !== orderId) {
      throw new PaymentVerificationError(400, "ORDER_MISMATCH", "Payment does not belong to this order.");
    }

    let expectedAmount: number;
    let expectedCurrency: string;
    if (checkout) {
      expectedAmount = checkout.amountPaise;
      expectedCurrency = checkout.currency;
    } else {
      const order = await razorpayService.fetchOrder(orderId);
      expectedAmount = Number(order.amount);
      expectedCurrency = order.currency;
    }

    if (Number(payment.amount) !== expectedAmount || (payment.currency || "INR") !== (expectedCurrency || "INR")) {
      throw new PaymentVerificationError(400, "AMOUNT_MISMATCH", "Paid amount does not match the order amount.");
    }

    if (payment.status === "authorized") {
      try {
        payment = await razorpayService.capturePayment(paymentId, Number(payment.amount), payment.currency || "INR");
      } catch (err: any) {
        // Another caller (or auto-capture) may have captured it in the meantime; re-read.
        payment = await razorpayService.fetchPayment(paymentId);
      }
    }

    if (payment.status !== "captured") {
      throw new PaymentVerificationError(402, "PAYMENT_NOT_CAPTURED", `Payment is ${payment.status}, not captured.`);
    }

    return { payment, checkout, amountPaise: Number(payment.amount) };
  },

  /**
   * Run `fulfil` at most once per Razorpay order. The first caller atomically moves the row
   * CREATED/FAILED → PROCESSING and fulfils; later callers get the stored result (DUPLICATE) or
   * IN_PROGRESS while the first one is still running. A failure marks the row FAILED so a
   * retry (client or webhook redelivery) can try again.
   */
  async fulfilOnce(params: {
    orderId: string;
    paymentId: string;
    purpose: CheckoutPurpose;
    amountPaise: number;
    currency?: string;
    userId?: string | null;
    via: FulfilmentChannel;
    fulfil: (checkout: RazorpayCheckoutRow) => Promise<any>;
  }): Promise<FulfilmentOutcome> {
    const { orderId, paymentId, via } = params;

    // Orders created before checkout records existed get a row on first sight.
    await prisma.razorpayCheckout.upsert({
      where: { razorpayOrderId: orderId },
      create: {
        razorpayOrderId: orderId,
        purpose: params.purpose,
        userId: params.userId || null,
        amountPaise: params.amountPaise,
        currency: params.currency || "INR",
        snapshot: toJson({}),
      },
      update: {},
    });

    let claimed = 0;
    try {
      const claim = await prisma.razorpayCheckout.updateMany({
        where: { razorpayOrderId: orderId, status: { in: ["CREATED", "FAILED"] } },
        data: { status: "PROCESSING", razorpayPaymentId: paymentId, fulfilledVia: via, lastError: null },
      });
      claimed = claim.count;
    } catch (err: any) {
      // Unique violation on razorpayPaymentId: this payment already fulfilled another order row.
      if (err?.code !== "P2002") throw err;
    }

    const row = await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } });
    if (!row) throw new Error(`Checkout record for ${orderId} disappeared`);

    if (claimed === 0) {
      if (row.status === "FULFILLED") return { state: "DUPLICATE", result: row.result };
      return { state: "IN_PROGRESS", result: null };
    }

    try {
      const result = await params.fulfil(row);
      await prisma.razorpayCheckout.update({
        where: { razorpayOrderId: orderId },
        data: { status: "FULFILLED", result: toJson(result), fulfilledAt: new Date() },
      });
      return { state: "FULFILLED", result };
    } catch (err: any) {
      await prisma.razorpayCheckout.update({
        where: { razorpayOrderId: orderId },
        data: { status: "FAILED", lastError: String(err?.message || err).slice(0, 500) },
      });
      throw err;
    }
  },

  /** Note a captured payment we could not fulfil yet (e.g. webhook arrived without a cart). */
  async markPaidAwaitingDetails(orderId: string, paymentId: string, reason: string) {
    await prisma.razorpayCheckout.updateMany({
      where: { razorpayOrderId: orderId, status: { in: ["CREATED", "FAILED"] } },
      data: { lastError: `${reason} (payment ${paymentId})`.slice(0, 500) },
    });
  },
};
