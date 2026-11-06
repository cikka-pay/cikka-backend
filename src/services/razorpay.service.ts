import crypto from "crypto";
import Razorpay from "razorpay";
import { config, isRazorpayStubMode } from "../config/env";

function getKeyId(): string {
  return (process.env.RAZORPAY_KEY_ID || config.razorpayKeyId || "").trim();
}

function getKeySecret(): string {
  return (process.env.RAZORPAY_KEY_SECRET || config.razorpayKeySecret || "").trim();
}

export function hasRazorpayCredentials(): boolean {
  return Boolean(getKeyId() && getKeySecret());
}

function getRazorpayClient() {
  const key_id = getKeyId();
  const key_secret = getKeySecret();

  if (!key_id || !key_secret) {
    throw new Error("Razorpay credentials (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET) are not configured.");
  }

  return {
    client: new Razorpay({ key_id, key_secret }),
    key_id,
  };
}

/** Constant-time compare of two hex digests; false on any length mismatch. */
export function safeEqualHex(expected: string, received: string): boolean {
  const a = Buffer.from(String(expected), "utf-8");
  const b = Buffer.from(String(received), "utf-8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function gatewayError(err: any, fallback: string): string {
  return err?.error?.description || err?.message || fallback;
}

export interface CreateRazorpayOrderDTO {
  amount: number; // in paise
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
}

/** Subset of the Razorpay payment entity we rely on (GET /v1/payments/:id). */
export interface RazorpayPaymentEntity {
  id: string;
  order_id: string | null;
  amount: number; // paise
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed" | string;
  captured?: boolean;
  method?: string;
  email?: string;
  contact?: string;
}

/** Subset of the Razorpay order entity we rely on (GET /v1/orders/:id). */
export interface RazorpayOrderEntity {
  id: string;
  amount: number; // paise
  amount_paid?: number;
  currency: string;
  status: string;
  receipt?: string;
  notes?: Record<string, string> | any[];
}

export const STUB_ORDER_PREFIX = "order_stub_";
export const STUB_PAYMENT_PREFIX = "pay_stub_";

export const razorpayService = {
  /**
   * Create a Razorpay Order (POST /v1/orders). Minimum amount: 100 paise (₹1).
   * In stub mode without keys a fake `order_stub_*` id is returned instead.
   */
  async createOrder(data: CreateRazorpayOrderDTO): Promise<RazorpayOrderResult> {
    const amountInPaise = Math.round(data.amount);
    if (!Number.isFinite(amountInPaise) || amountInPaise < 100) {
      throw new Error("Minimum order amount must be at least 100 paise (₹1.00)");
    }
    const receipt = (data.receipt || `rcpt_${Date.now()}`).slice(0, 40);
    const currency = data.currency || "INR";

    if (isRazorpayStubMode() && !hasRazorpayCredentials()) {
      return {
        order_id: `${STUB_ORDER_PREFIX}${crypto.randomBytes(7).toString("hex")}`,
        amount: amountInPaise,
        currency,
        key_id: "rzp_test_stub",
      };
    }

    const { client, key_id } = getRazorpayClient();
    try {
      const order = await client.orders.create({
        amount: amountInPaise,
        currency,
        receipt,
        notes: data.notes || {},
      });

      return {
        order_id: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        key_id,
      };
    } catch (err: any) {
      const errorMsg = gatewayError(err, "Failed to create Razorpay Order");
      console.error(`[Razorpay Service Error] client.orders.create failed: ${errorMsg}`);
      throw new Error(`Razorpay Gateway Error: ${errorMsg}`);
    }
  },

  /** GET /v1/payments/:id — the source of truth for status, order_id and amount. */
  async fetchPayment(paymentId: string): Promise<RazorpayPaymentEntity> {
    const { client } = getRazorpayClient();
    try {
      return (await client.payments.fetch(paymentId)) as unknown as RazorpayPaymentEntity;
    } catch (err: any) {
      throw new Error(`Razorpay Gateway Error: ${gatewayError(err, "Failed to fetch payment")}`);
    }
  },

  /** GET /v1/orders/:id — gives the amount the order was created for. */
  async fetchOrder(orderId: string): Promise<RazorpayOrderEntity> {
    const { client } = getRazorpayClient();
    try {
      return (await client.orders.fetch(orderId)) as unknown as RazorpayOrderEntity;
    } catch (err: any) {
      throw new Error(`Razorpay Gateway Error: ${gatewayError(err, "Failed to fetch order")}`);
    }
  },

  /** POST /v1/payments/:id/capture — moves an `authorized` payment to `captured`. */
  async capturePayment(paymentId: string, amountInPaise: number, currency = "INR"): Promise<RazorpayPaymentEntity> {
    const { client } = getRazorpayClient();
    try {
      return (await client.payments.capture(paymentId, amountInPaise, currency)) as unknown as RazorpayPaymentEntity;
    } catch (err: any) {
      throw new Error(`Razorpay Gateway Error: ${gatewayError(err, "Failed to capture payment")}`);
    }
  },

  /**
   * Verify the Checkout payment signature.
   * Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET), compared in constant time.
   * Only the key secret is needed; a missing secret means "not verified", never an exception.
   */
  verifyPaymentSignature(
    razorpay_order_id: string,
    razorpay_payment_id: string,
    razorpay_signature: string
  ): boolean {
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return false;
    }

    // Dev/mock bypasses only in stub mode, which can never be on in production.
    if (
      isRazorpayStubMode() &&
      (razorpay_order_id.startsWith("order_dev_") ||
        razorpay_payment_id.startsWith("pay_dev_") ||
        razorpay_signature === "mock_signature_valid")
    ) {
      return true;
    }

    const keySecret = getKeySecret();
    if (!keySecret) return false;

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    return safeEqualHex(expectedSignature, String(razorpay_signature));
  },

  /**
   * Refund a captured payment (POST /v1/payments/:id/refund).
   * `receipt` is Razorpay's idempotency key for refunds: a retry with the same receipt
   * cannot create a second refund on the same payment.
   */
  async refundPayment(
    paymentId: string,
    amountInPaise?: number,
    notes?: Record<string, string>,
    receipt?: string
  ): Promise<{ success: boolean; refundId?: string; amount?: number; error?: string; message?: string }> {
    if (!paymentId) {
      return { success: false, error: "Payment ID is required to process refund" };
    }

    if (isRazorpayStubMode() && (!hasRazorpayCredentials() || paymentId.startsWith(STUB_PAYMENT_PREFIX))) {
      return {
        success: true,
        refundId: `rfnd_stub_${crypto.randomBytes(6).toString("hex")}`,
        amount: amountInPaise ? amountInPaise / 100 : undefined,
        message: "[Stub] Customer refund simulated",
      };
    }

    try {
      const { client } = getRazorpayClient();
      const options: any = { notes: notes || {} };
      if (amountInPaise && amountInPaise > 0) {
        options.amount = Math.round(amountInPaise);
      }
      if (receipt) options.receipt = receipt.slice(0, 40);
      const refund = await (client.payments as any).refund(paymentId, options);
      return {
        success: true,
        refundId: refund.id,
        amount: refund.amount ? Number(refund.amount) / 100 : undefined,
        message: "Customer refund issued successfully",
      };
    } catch (err: any) {
      const errorMsg = gatewayError(err, "Failed to process Razorpay refund");
      console.warn(`[Razorpay Refund Notice]: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  },
};
