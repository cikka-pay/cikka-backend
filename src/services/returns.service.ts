/**
 * Money side of returns and exchanges (spec 003 §7, §10): the order's settlement, its payment,
 * reversing the held seller transfer at most once, and exchange eligibility + execution.
 * Shared by the returns controller and checkout fulfilment (paid exchange upgrades).
 */
import { prisma } from "../config/prisma";
import { ReturnStatus, NotificationType } from "../generated/prisma/client";
import { shipwayService } from "./shipway.service";
import { razorpayRouteService } from "./razorpayRoute.service";
import { razorpayService } from "./razorpay.service";
import {
  baseRazorpayOrderId,
  checkExchangeOrder,
  decimalToPaise,
  paiseToRupees,
  priceLines,
  PricingError,
  PricedLine,
} from "./mallPricing.service";

export { baseRazorpayOrderId };

/** The settlement written for this order at fulfilment (never "the seller's latest one"). */
export function findOrderSettlement(order: { id: string; orderNumber: string; sellerId: string }) {
  return prisma.settlement.findFirst({
    where: {
      sellerId: order.sellerId,
      OR: [{ orderId: order.id }, { orderNumber: order.orderNumber }],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Payment id to refund: from the order's settlement, else from its Razorpay checkout record. */
export async function findOrderPaymentId(
  order: { orderNumber: string },
  settlement: { razorpayPaymentId: string | null } | null
): Promise<string | null> {
  if (settlement?.razorpayPaymentId) return settlement.razorpayPaymentId;
  const checkout = await prisma.razorpayCheckout.findUnique({
    where: { razorpayOrderId: baseRazorpayOrderId(order.orderNumber) },
  });
  return checkout?.razorpayPaymentId ?? null;
}

/**
 * Reverse the seller's held transfer for this order exactly once: the settlement is claimed
 * ON_HOLD → REVERSING first, so concurrent or repeated calls cannot reverse twice.
 * A full refund reverses the whole transfer and marks the settlement REVERSED (never payable
 * again); a partial one reverses at most the refund, keeps it PENDING with a lower netPayable.
 * A settlement whose transfer was never made (PENDING_TRANSFER / TRANSFER_FAILED) is simply
 * cancelled (full) or reduced (partial).
 */
export async function reverseOrderTransferOnce(
  settlement: { id: string; razorpayTransferId: string | null; netPayable: any; transferStatus?: string | null } | null,
  refundAmount: number,
  orderTotal: number,
  reason: string
) {
  if (!settlement) return null;
  const fullReversal = refundAmount >= orderTotal;
  const netPaise = decimalToPaise(settlement.netPayable);

  if (!settlement.razorpayTransferId) {
    // Nothing reached the seller yet: stop it from ever being transferred.
    const claim = await prisma.settlement.updateMany({
      where: { id: settlement.id, razorpayTransferId: null, status: "PENDING" },
      data: fullReversal
        ? { status: "REVERSED", transferStatus: "CANCELLED", failureReason: reason }
        : { netPayable: paiseToRupees(Math.max(0, netPaise - Math.round(refundAmount * 100))).toFixed(2), failureReason: reason },
    });
    return claim.count > 0
      ? { success: true, skipped: true, message: "No transfer had been made; payout cancelled/reduced" }
      : { success: false, skipped: true, message: "Settlement already closed" };
  }

  const claim = await prisma.settlement.updateMany({
    where: { id: settlement.id, transferStatus: "ON_HOLD" },
    data: { transferStatus: "REVERSING" },
  });
  if (claim.count === 0) return { success: false, skipped: true, message: "Transfer already reversed or released" };

  const reversePaise = fullReversal ? undefined : Math.min(Math.round(refundAmount * 100), netPaise);

  const result = await razorpayRouteService.reverseTransfer(settlement.razorpayTransferId, reversePaise, reason);
  await prisma.settlement.update({
    where: { id: settlement.id },
    data: result.success
      ? fullReversal
        ? { status: "REVERSED", transferStatus: "REVERSED", failureReason: reason }
        : {
            transferStatus: "PARTIALLY_REVERSED",
            netPayable: paiseToRupees(Math.max(0, netPaise - (reversePaise || 0))).toFixed(2),
            failureReason: reason,
          }
      : { transferStatus: "ON_HOLD", failureReason: `Reversal failed: ${result.error}` },
  });
  return result;
}

// ── Exchanges ────────────────────────────────────────────────────────────────

export class ExchangeError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "ExchangeError";
  }
}

export interface ExchangeEligibilityInput {
  orderId?: string | null;
  orderNumber?: string | null;
  newProductId?: string | null;
  newVariantId?: string | null;
}

/**
 * Can `userId` exchange this order for this product? Same rules the exchange itself and the
 * exchange checkout use, so the app can ask before taking any payment.
 */
export async function checkExchangeEligibility(userId: string | null, input: ExchangeEligibilityInput) {
  const reasons: Array<{ code: string; message: string }> = [];
  const orderCheck = await checkExchangeOrder(userId, { orderId: input.orderId, orderNumber: input.orderNumber });
  reasons.push(...orderCheck.reasons);

  let line: PricedLine | null = null;
  if (!input.newProductId) {
    reasons.push({ code: "PRODUCT_REQUIRED", message: "newProductId is required." });
  } else {
    try {
      [line] = await priceLines([{ productId: String(input.newProductId), variantId: input.newVariantId || null, qty: 1 }]);
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
      reasons.push({ code: err.code, message: err.message });
    }
  }

  const creditPaise = orderCheck.creditPaise;
  const newPricePaise = line?.unitPricePaise ?? 0;
  return {
    eligible: reasons.length === 0,
    reasons,
    order: orderCheck.order,
    line,
    creditPaise,
    newPricePaise,
    amountDuePaise: line ? Math.max(0, newPricePaise - creditPaise) : 0,
    refundDuePaise: line ? Math.max(0, creditPaise - newPricePaise) : 0,
  };
}

export function eligibilityResponse(e: Awaited<ReturnType<typeof checkExchangeEligibility>>) {
  return {
    eligible: e.eligible,
    reasons: e.reasons,
    order_id: e.order?.id ?? null,
    order_number: e.order?.orderNumber ?? null,
    credit: paiseToRupees(e.creditPaise),
    new_product_id: e.line?.productId ?? null,
    new_variant_id: e.line?.variantId ?? null,
    new_price: e.line ? paiseToRupees(e.newPricePaise) : null,
    amount_due: paiseToRupees(e.amountDuePaise),
    amount_due_paise: e.amountDuePaise,
    refund_due: paiseToRupees(e.refundDuePaise),
    requires_payment: e.amountDuePaise > 0,
    same_seller: e.order && e.line ? e.order.sellerId === e.line.sellerId : null,
  };
}

/**
 * File an exchange (zero seller approval). Re-checks eligibility first. A price increase must
 * already be paid: `paidDelta` comes from the exchange checkout's captured payment.
 */
export async function executeExchange(params: {
  userId: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  newProductId: string;
  newVariantId?: string | null;
  productId?: string | null;
  reason?: string | null;
  paidDelta?: { paymentId: string; amountPaise: number } | null;
}) {
  const eligibility = await checkExchangeEligibility(params.userId, params);
  if (!eligibility.eligible || !eligibility.order || !eligibility.line) {
    throw new ExchangeError(409, "EXCHANGE_NOT_ELIGIBLE", eligibility.reasons[0]?.message || "This order cannot be exchanged.", {
      reasons: eligibility.reasons,
    });
  }
  if (eligibility.amountDuePaise > 0 && (!params.paidDelta || params.paidDelta.amountPaise < eligibility.amountDuePaise)) {
    throw new ExchangeError(
      402,
      "PAYMENT_REQUIRED",
      `Pay the difference of ₹${paiseToRupees(eligibility.amountDuePaise).toFixed(2)} through checkout with exchange: { orderId }.`,
      { amount_due: paiseToRupees(eligibility.amountDuePaise), amount_due_paise: eligibility.amountDuePaise }
    );
  }

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: eligibility.order.id },
    include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
  });

  // An order can be exchanged once; repeating the call must not refund or claw back again.
  const exchangeClaim = await prisma.order.updateMany({
    where: { id: order.id, status: { notIn: ["EXCHANGE", "RETURNED", "CANCELLED"] } },
    data: { status: "EXCHANGE" },
  });
  if (exchangeClaim.count === 0) {
    throw new ExchangeError(409, "EXCHANGE_NOT_ELIGIBLE", "This order has already been exchanged, returned or cancelled");
  }

  const newProduct = await prisma.product.findUniqueOrThrow({ where: { id: eligibility.line.productId } });
  const reason = params.reason;
  let origProdId = params.productId || null;
  if (!origProdId && order.items && order.items.length > 0) origProdId = order.items[0].productId;
  if (!origProdId) origProdId = newProduct.id;

  // Server prices only: the original order total and the replacement's DB price.
  const oldPrice = paiseToRupees(eligibility.creditPaise);
  const newPrice = paiseToRupees(eligibility.newPricePaise);
  const delta = newPrice - oldPrice;
  const isSameSeller = order.sellerId === newProduct.sellerId;

  // 1. Create Return record auto-approved for exchange
  const ret = await prisma.return.create({
    data: {
      orderId: order.id,
      productId: origProdId,
      reason: `EXCHANGE: ${reason || "Exchange request"} (Exchanged for: ${newProduct.name})`,
      refundAmount: delta < 0 ? Math.abs(delta) : 0,
      status: ReturnStatus.APPROVED,
    },
    include: { order: true, product: true },
  });

  // 1b. Order status was already moved to EXCHANGE by the claim above.

  // 2. Trigger Shipway Reverse Courier for old parcel
  let reverseDetails: any = null;
  try {
    const pickupAddress = order.seller?.onboarding?.pickupAddress as any;
    reverseDetails = await shipwayService.createReversePickup({
      returnId: ret.id,
      orderId: order.orderNumber,
      customerName: order.customerName,
      customerPhone: "9876543210",
      customerAddress: `Customer Residence, ${order.customerCity || "City"}`,
      customerCity: order.customerCity || "Mumbai",
      customerState: "Maharashtra",
      customerPincode: "400001",
      warehousePincode: pickupAddress?.pincode || "122008",
      warehouseCity: pickupAddress?.city || "Gurugram",
      productName: ret.product?.name || "Original Item",
      productSku: ret.product?.sku,
      refundAmount: delta < 0 ? Math.abs(delta) : 0,
    });
  } catch (shipErr: any) {
    console.warn("[Exchange Shipway Notice]:", shipErr.message);
  }

  // 3. Locate this order's settlement (still on hold) and the payment to refund against
  const orderSettlement = await findOrderSettlement(order);
  const settlement = orderSettlement?.transferStatus === "ON_HOLD" ? orderSettlement : null;
  const exchangePaymentId = await findOrderPaymentId(order, orderSettlement);

  let clawbackResult: any = null;
  let customerRefundResult: any = null;
  let routingSummary: any = null;

  // =========================================================================
  // BRANCH A: SAME SELLER EXCHANGE
  // =========================================================================
  if (isSameSeller) {
    const extendedHold = new Date(Date.now() + 7 * 86400000);

    if (delta > 0) {
      // UPGRADE: User must pay extra delta
      routingSummary = {
        type: "SAME_SELLER_UPGRADE",
        oldPrice,
        newPrice,
        customerDifferenceDue: delta,
        action: "CUSTOMER_CHARGE_REQUIRED",
        message: `Customer must pay remaining ₹${delta.toFixed(2)}. Extra funds will route to Seller #${order.sellerId}. Payout hold extended by T+7.`,
      };

      if (settlement) {
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            holdUntil: extendedHold,
            payoutDate: extendedHold,
            failureReason: `Exchange upgrade in-progress. Extra ₹${delta.toFixed(2)} to be added upon customer payment.`,
          } as any,
        });
      }
    } else if (delta < 0) {
      // DOWNGRADE: Customer gets instant refund of delta
      const refundPaise = Math.round(Math.abs(delta) * 100);
      if (exchangePaymentId) {
        customerRefundResult = await razorpayService.refundPayment(
          exchangePaymentId,
          refundPaise,
          {
            orderNumber: order.orderNumber,
            reason: `Exchange downgrade refund: ${Math.abs(delta)} INR`,
          },
          `exc_${ret.id}`
        );
      }

      routingSummary = {
        type: "SAME_SELLER_DOWNGRADE",
        oldPrice,
        newPrice,
        customerRefundAmount: Math.abs(delta),
        action: "INSTANT_REFUND_EXECUTED",
        message: `Instant refund of ₹${Math.abs(delta).toFixed(2)} sent to customer. Seller payout reduced and hold extended by T+7.`,
      };

      if (settlement) {
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            netPayable: Math.max(0, Number(settlement.netPayable) - Math.abs(delta)),
            holdUntil: extendedHold,
            payoutDate: extendedHold,
          } as any,
        });
      }
    } else {
      // SIZE / COLOR EQUAL VALUE SWAP
      routingSummary = {
        type: "SAME_SELLER_EQUAL_SWAP",
        oldPrice,
        newPrice,
        delta: 0,
        action: "HOLD_EXTENDED",
        message: "Size/variant exchange. No price difference. Payout hold extended by T+7 for replacement delivery.",
      };

      if (settlement) {
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: { holdUntil: extendedHold, payoutDate: extendedHold } as any,
        });
      }
    }

    // In-app alert to same seller
    await prisma.notification.create({
      data: {
        sellerId: order.sellerId,
        type: NotificationType.ORDER,
        title: `Exchange Request Auto-Approved: #${order.orderNumber}`,
        body: `Customer requested exchange for ${newProduct.name}. Reverse AWB: ${reverseDetails?.reverseAwb || "Generated"}. Return & replacement shipping fees (₹129.80 total) adjusted from your settlement. Prepare replacement parcel.`,
        metadata: {
          orderNumber: order.orderNumber,
          isExchange: true,
          isSameSeller: true,
          delta,
          shippingAdjusted: 129.80,
        },
      },
    }).catch(() => {});
  }
  // =========================================================================
  // BRANCH B: DIFFERENT SELLER (Cross-Brand Exchange)
  // Shift original payout from Seller A to Seller B; charge overall shipping from Seller B.
  // =========================================================================
  else {
    // 1. Claw back 100% of held payout from Seller A (Old Seller)
    // Full reversal of this order's held transfer, at most once (only reported REVERSED on success).
    clawbackResult = await reverseOrderTransferOnce(
      settlement,
      oldPrice,
      oldPrice,
      `Cross-brand exchange from Seller ${order.sellerId} to Seller ${newProduct.sellerId}`
    );

    // 2. Alert Old Seller of clawback
    await prisma.notification.create({
      data: {
        sellerId: order.sellerId,
        type: NotificationType.SETTLEMENT,
        title: `Exchange Reversal: Order #${order.orderNumber}`,
        body: `Customer exchanged item for another brand. Original payout was clawed back to escrow. Reverse parcel is en route back to your warehouse.`,
        metadata: {
          orderNumber: order.orderNumber,
          crossBrandExchange: true,
        },
      },
    }).catch(() => {});

    // 3. Overall Shipping Charges (both reverse pickup of old item + forward delivery of replacement item)
    // are charged from the NEW SELLER (Seller B)
    const overallShippingChargedToNewSeller = 129.80; // ₹64.90 reverse + ₹64.90 forward
    const newBase = Number((newPrice / 1.18).toFixed(2));
    const newCommission = Number((newBase * 0.22).toFixed(2));
    const netSellerBPayout = Math.max(0, newPrice - newCommission - overallShippingChargedToNewSeller);

    // Create new settlement record for Seller B with overall shipping deducted
    await prisma.settlement.create({
      data: {
        sellerId: newProduct.sellerId,
        periodStart: new Date(),
        periodEnd: new Date(),
        category: "Cross-Brand Exchange Order",
        grossSales: newPrice,
        basePrice: newBase,
        commissionAmount: newCommission,
        shippingFee: 110, // 55 x 2
        shippingTotal: overallShippingChargedToNewSeller, // 64.90 x 2
        netPayable: netSellerBPayout,
        status: "PENDING",
        transferStatus: "ON_HOLD",
        holdUntil: new Date(Date.now() + 7 * 86400000),
        payoutDate: new Date(Date.now() + 7 * 86400000),
        failureReason: `New sale gained via cross-brand exchange. Overall logistics (₹129.80: reverse pickup of old item + forward replacement) adjusted from new seller.`,
        ledgerBreakdown: {
          originalOrderNumber: order.orderNumber,
          oldSellerId: order.sellerId,
          newSellerId: newProduct.sellerId,
          reverseShippingCharged: 64.90,
          forwardShippingCharged: 64.90,
          totalShippingAdjusted: overallShippingChargedToNewSeller,
          netPayable: netSellerBPayout,
        } as any,
      } as any,
    }).catch((err: any) => {
      console.warn("[Cross-Seller Settlement Notice]:", err.message);
    });

    // 4. Handle delta with customer and new seller setup
    if (delta > 0) {
      routingSummary = {
        type: "CROSS_SELLER_UPGRADE",
        oldSellerId: order.sellerId,
        newSellerId: newProduct.sellerId,
        oldPrice,
        newPrice,
        customerDifferenceDue: delta,
        totalNewSellerPayout: netSellerBPayout,
        overallShippingChargedToNewSeller,
        action: "CHARGE_CUSTOMER_DELTA_AND_TRANSFER_TO_NEW_SELLER",
        message: `Payout reversed from Seller A. Customer charged ₹${delta.toFixed(2)}. Entire ₹${newPrice.toFixed(2)} shifts to Seller B (minus ₹129.80 overall exchange shipping).`,
      };
    } else if (delta < 0) {
      const refundPaise = Math.round(Math.abs(delta) * 100);
      if (exchangePaymentId) {
        customerRefundResult = await razorpayService.refundPayment(
          exchangePaymentId,
          refundPaise,
          {
            orderNumber: order.orderNumber,
            reason: `Cross-brand exchange downgrade refund: ${Math.abs(delta)} INR`,
          },
          `exc_${ret.id}`
        );
      }

      routingSummary = {
        type: "CROSS_SELLER_DOWNGRADE",
        oldSellerId: order.sellerId,
        newSellerId: newProduct.sellerId,
        oldPrice,
        newPrice,
        customerRefundAmount: Math.abs(delta),
        totalNewSellerPayout: netSellerBPayout,
        overallShippingChargedToNewSeller,
        action: "REFUND_DELTA_AND_TRANSFER_LOWER_VALUE_TO_NEW_SELLER",
        message: `Payout reversed from Seller A. Instant refund of ₹${Math.abs(delta).toFixed(2)} sent to customer. New payout of ₹${netSellerBPayout.toFixed(2)} (minus ₹129.80 overall exchange shipping) assigned to Seller B.`,
      };
    } else {
      routingSummary = {
        type: "CROSS_SELLER_EQUAL_SWAP",
        oldSellerId: order.sellerId,
        newSellerId: newProduct.sellerId,
        oldPrice,
        newPrice,
        totalNewSellerPayout: netSellerBPayout,
        overallShippingChargedToNewSeller,
        action: "TRANSFER_ORIGINAL_VALUE_TO_NEW_SELLER",
        message: `Payout reversed from Seller A. ₹${oldPrice.toFixed(2)} shifts to Seller B (minus ₹129.80 overall exchange shipping: net ₹${netSellerBPayout.toFixed(2)}).`,
      };
    }

    // 5. Alert New Seller of incoming exchange order with shipping charge detail
    await prisma.notification.create({
      data: {
        sellerId: newProduct.sellerId,
        type: NotificationType.ORDER,
        title: `New Exchange Order Received: ${newProduct.name}`,
        body: `Customer selected your product in a cross-brand exchange (Order #${order.orderNumber}). Overall exchange shipping (₹129.80: reverse pickup of old item + forward dispatch) adjusted from your settlement. Net payout: ₹${netSellerBPayout.toFixed(2)}.`,
        metadata: {
          orderNumber: order.orderNumber,
          newProductId: newProduct.id,
          newPrice,
          overallShippingCharged: overallShippingChargedToNewSeller,
          netPayout: netSellerBPayout,
        },
      },
    }).catch(() => {});
  }


  if (delta > 0 && params.paidDelta && routingSummary) {
    routingSummary = {
      ...routingSummary,
      action: "CUSTOMER_DELTA_PAID",
      deltaPaymentId: params.paidDelta.paymentId,
      deltaPaid: paiseToRupees(params.paidDelta.amountPaise),
    };
  }

  return { ret, reverseDetails, routingSummary, clawbackResult, customerRefundResult };
}
