import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, ReturnStatus, NotificationType } from "../generated/prisma/client";
import { shipwayService } from "../services/shipway.service";
import { razorpayRouteService } from "../services/razorpayRoute.service";
import { razorpayService } from "../services/razorpay.service";

/** Razorpay order id behind an order number (`order_X` or `order_X-<n>` for multi-item carts). */
function baseRazorpayOrderId(orderNumber: string): string {
  return orderNumber.replace(/-\d+$/, "");
}

/** The settlement written for this order at fulfilment (never "the seller's latest one"). */
function findOrderSettlement(order: { id: string; orderNumber: string; sellerId: string }) {
  return prisma.settlement.findFirst({
    where: {
      sellerId: order.sellerId,
      OR: [{ orderId: order.id }, { orderNumber: order.orderNumber }],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Payment id to refund: from the order's settlement, else from its Razorpay checkout record. */
async function findOrderPaymentId(
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
 * A full refund reverses the whole transfer; a partial one reverses at most the refund.
 */
async function reverseOrderTransferOnce(
  settlement: { id: string; razorpayTransferId: string | null; netPayable: any } | null,
  refundAmount: number,
  orderTotal: number,
  reason: string
) {
  if (!settlement?.razorpayTransferId) return null;
  const claim = await prisma.settlement.updateMany({
    where: { id: settlement.id, transferStatus: "ON_HOLD" },
    data: { transferStatus: "REVERSING" } as any,
  });
  if (claim.count === 0) return { success: false, skipped: true, message: "Transfer already reversed or released" };

  const fullReversal = refundAmount >= orderTotal;
  const reversePaise = fullReversal
    ? undefined
    : Math.min(Math.round(refundAmount * 100), Math.round(Number(settlement.netPayable) * 100));

  const result = await razorpayRouteService.reverseTransfer(settlement.razorpayTransferId, reversePaise, reason);
  await prisma.settlement.update({
    where: { id: settlement.id },
    data: result.success
      ? ({ transferStatus: "REVERSED", failureReason: reason } as any) // SettlementStatus has no CANCELLED; REVERSED marks it
      : ({ transferStatus: "ON_HOLD", failureReason: `Reversal failed: ${result.error}` } as any),
  });
  return result;
}

/**
 * Refund amount from server data: the order total, or a smaller positive partial amount.
 * Never more than the order was sold for.
 */
function serverRefundAmount(requested: unknown, orderTotal: number): number {
  const n = Number(requested);
  if (requested === undefined || requested === null || requested === "" || !Number.isFinite(n) || n <= 0) {
    return orderTotal;
  }
  return Math.min(Number(n.toFixed(2)), orderTotal);
}

/**
 * Orders placed through a Razorpay checkout recorded with a user may only be returned by that
 * user. Returns an error message, or null when allowed.
 */
async function checkOrderOwnership(orderNumber: string, userId?: string): Promise<string | null> {
  const checkout = await prisma.razorpayCheckout.findUnique({
    where: { razorpayOrderId: baseRazorpayOrderId(orderNumber) },
  });
  if (checkout?.userId && checkout.userId !== userId) return "This order belongs to another account";
  return null;
}

export const listReturns = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { page = "1", limit = "100", status } = req.query as any;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 100;
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.ReturnWhereInput = { order: { sellerId } };

  if (status && status !== "ALL") {
    where.status = status as ReturnStatus;
  }

  const [data, total] = await Promise.all([
    prisma.return.findMany({
      where,
      skip,
      take: limitNum,
      include: {
        order: {
          include: {
            seller: {
              include: { onboarding: true },
            },
          },
        },
        product: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.return.count({ where }),
  ]);

  const sanitizedData = data.map((ret) => {
    return {
      ...ret,
      reverseAwb: (ret as any).reverseAwb || null,
    };
  });

  res.json({
    data: sanitizedData,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

export const updateReturnStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const sellerId = req.seller!.id;
  const { status, qcStatus, qcNotes } = req.body;

  const ret = await prisma.return.findFirst({
    where: { id, order: { sellerId } },
    include: {
      order: {
        include: {
          seller: { include: { onboarding: true } },
        },
      },
      product: true,
    },
  });

  if (!ret) {
    res.status(404).json({ error: "Return not found" });
    return;
  }

  // 1. If approved, trigger Shipway Reverse Logistics
  let reverseDetails: any = null;
  if (status === "APPROVED") {
    try {
      const pickupAddress = ret.order.seller?.onboarding?.pickupAddress as any;
      const warehousePincode = pickupAddress?.pincode || "122008";
      const warehouseCity = pickupAddress?.city || "Gurugram";

      reverseDetails = await shipwayService.createReversePickup({
        returnId: ret.id,
        orderId: ret.order.orderNumber,
        customerName: ret.order.customerName,
        customerPhone: "9876543210",
        customerAddress: `Customer Residence, ${ret.order.customerCity || "City"}`,
        customerCity: ret.order.customerCity || "Mumbai",
        customerState: "Maharashtra",
        customerPincode: "400001",
        warehousePincode,
        warehouseCity,
        productName: ret.product.name,
        productSku: ret.product.sku,
        refundAmount: Number(ret.refundAmount),
      });

      // Notification to seller
      await prisma.notification.create({
        data: {
          sellerId,
          type: NotificationType.ORDER,
          title: `Reverse Pickup Booked: #${ret.order.orderNumber}`,
          body: `Return approved! Courier ${reverseDetails.courier} assigned. Reverse AWB: ${reverseDetails.reverseAwb}`,
          metadata: {
            returnId: ret.id,
            orderId: ret.order.id,
            reverseAwb: reverseDetails.reverseAwb,
          },
        },
      }).catch(() => {});
    } catch (err: any) {
      console.warn("[Shipway Reverse Booking Notice]:", err.message);
    }
  }

  // 2. Payout clawback (within the hold window) and customer refund — each at most once.
  let reversalResult: any = null;
  let customerRefundResult: any = null;
  const refundAmount = Number(ret.refundAmount);
  const orderTotal = Number(ret.order.totalAmount);

  if (status === "APPROVED" || status === "REFUNDED") {
    try {
      const settlement = await findOrderSettlement(ret.order);
      reversalResult = await reverseOrderTransferOnce(
        settlement,
        refundAmount,
        orderTotal,
        `Return #${ret.id} for Order #${ret.order.orderNumber}`
      );

      if (reversalResult?.success) {
        await prisma.notification.create({
          data: {
            sellerId,
            type: NotificationType.SETTLEMENT,
            title: `Payout Clawback Reversal: Order #${ret.order.orderNumber}`,
            body: `Return approved within hold window. Your held payout for this order was reversed.`,
            metadata: { returnId: ret.id, transferId: settlement?.razorpayTransferId, amount: refundAmount },
          },
        }).catch(() => {});
      }

      // Refund only on the first move to REFUNDED; the refund receipt makes Razorpay reject
      // a second refund for the same return even if this is retried.
      if (status === "REFUNDED" && ret.status !== ReturnStatus.REFUNDED) {
        const paymentId = await findOrderPaymentId(ret.order, settlement);
        if (paymentId) {
          customerRefundResult = await razorpayService.refundPayment(
            paymentId,
            Math.round(refundAmount * 100),
            { returnId: ret.id, orderNumber: ret.order.orderNumber },
            `rtn_${ret.id}`
          );
          if (!customerRefundResult.success) {
            res.status(502).json({ error: `Refund failed: ${customerRefundResult.error}`, reversalResult, customerRefundResult });
            return;
          }
        }
      }
    } catch (clawbackErr: any) {
      console.warn("[Return Clawback/Refund Error]:", clawbackErr.message || clawbackErr);
    }
  }

  const updatedReturn = await prisma.return.update({
    where: { id },
    data: { status },
    include: { order: true, product: true },
  });

  res.json({
    ...updatedReturn,
    reverseDetails,
    reversalResult,
    customerRefundResult,
  });
});

export const createReturn = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, orderNumber, productId, reason, refundAmount } = req.body;

  if (!orderId && !orderNumber) {
    res.status(400).json({ error: "orderId or orderNumber is required to initiate a return" });
    return;
  }

  const include = { items: { include: { product: true } }, seller: { include: { onboarding: true } } } as const;
  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId }, include })
    : await prisma.order.findUnique({ where: { orderNumber }, include });

  if (!order) {
    res.status(404).json({ error: "Order not found to initiate return" });
    return;
  }

  const ownershipError = await checkOrderOwnership(order.orderNumber, req.user?.id);
  if (ownershipError) {
    res.status(403).json({ error: ownershipError });
    return;
  }

  // One active return per order: a second request must not refund or claw back again.
  const existingReturn = await prisma.return.findFirst({
    where: { orderId: order.id, status: { in: [ReturnStatus.REQUESTED, ReturnStatus.APPROVED, ReturnStatus.REFUNDED] } },
  });
  if (existingReturn) {
    res.status(409).json({ success: false, error: "A return already exists for this order", data: existingReturn });
    return;
  }

  let prodId = productId;
  if (!prodId && order.items && order.items.length > 0) {
    prodId = order.items[0].productId;
  }
  if (!prodId) {
    res.status(400).json({ error: "productId is required for this order" });
    return;
  }

  const orderTotal = Number(order.totalAmount);
  const effectiveRefundAmount = serverRefundAmount(refundAmount, orderTotal);

  // =========================================================================
  // SCENARIO 1: ORDER IS IN-TRANSIT (Cancellation / Return before delivery)
  // No seller approval required: instant refund & escrow clawback, each at most once.
  // =========================================================================
  const isInTransit = (order.status as any) !== "DELIVERED";

  if (isInTransit) {
    let ret = await prisma.return.create({
      data: {
        orderId: order.id,
        productId: prodId,
        reason: reason || "In-transit Return / Cancellation by customer",
        refundAmount: effectiveRefundAmount,
        status: ReturnStatus.APPROVED,
      },
      include: { order: true, product: true },
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { status: "RETURNED" as any },
    });

    const settlement = await findOrderSettlement(order);
    const clawbackResult = await reverseOrderTransferOnce(
      settlement,
      effectiveRefundAmount,
      orderTotal,
      `In-transit return #${ret.id} for Order #${order.orderNumber}`
    );

    let customerRefundResult: any = null;
    const paymentId = await findOrderPaymentId(order, settlement);
    if (paymentId) {
      customerRefundResult = await razorpayService.refundPayment(
        paymentId,
        Math.round(effectiveRefundAmount * 100),
        { returnId: ret.id, orderNumber: order.orderNumber, reason: "Instant In-Transit Return Refund" },
        `rtn_${ret.id}`
      );
      if (customerRefundResult.success) {
        ret = await prisma.return.update({
          where: { id: ret.id },
          data: { status: ReturnStatus.REFUNDED },
          include: { order: true, product: true },
        });
      }
    }

    await prisma.notification.create({
      data: {
        sellerId: order.sellerId,
        type: NotificationType.ORDER,
        title: `Order Returned in Transit (RTO): #${order.orderNumber}`,
        body: `Customer returned parcel while in transit. Escrow hold reversed (₹${effectiveRefundAmount.toFixed(2)}) and removed from active settlements. Courier is turning back to origin. Reason: ${ret.reason}`,
        metadata: {
          returnId: ret.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          inTransit: true,
          refundAmount: effectiveRefundAmount,
        },
      },
    }).catch(() => {});

    res.status(201).json({
      success: true,
      inTransit: true,
      autoApproved: true,
      message: "Order was in transit. Return auto-approved with instant customer refund and escrow payout clawback.",
      data: ret,
      clawbackResult,
      customerRefundResult,
    });
    return;
  }

  // =========================================================================
  // SCENARIO 2: ORDER ALREADY DELIVERED (Post-Delivery Return)
  // Requires seller inspection & approval with proper reasoning.
  // =========================================================================
  const ret = await prisma.return.create({
    data: {
      orderId: order.id,
      productId: prodId,
      reason: reason || "Product return requested after delivery",
      refundAmount: effectiveRefundAmount,
      status: ReturnStatus.REQUESTED,
    },
    include: {
      order: true,
      product: true,
    },
  });

  // Notify seller of incoming return request requiring approval
  await prisma.notification.create({
    data: {
      sellerId: order.sellerId,
      type: NotificationType.ORDER,
      title: `Return Requested (Approval Required): #${order.orderNumber}`,
      body: `Customer requested return for ${ret.product?.name || "delivered item"}. Reason: ${ret.reason}. Please inspect and approve/reject in your Seller Dashboard.`,
      metadata: {
        returnId: ret.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        deliveredReturn: true,
      },
    },
  }).catch(() => {});

  res.status(201).json({
    success: true,
    inTransit: false,
    autoApproved: false,
    message: "Return request submitted successfully. Awaiting seller review and approval.",
    data: ret,
  });
});

/**
 * POST /api/returns/exchange
 * Automated Exchange Handler (Zero seller approval required!)
 * Handles:
 * 1. Same-Seller vs Cross-Seller brand routing
 * 2. New Price > Old Price (charge customer delta; route delta to same seller or shift total to new seller)
 * 3. New Price < Old Price (instant refund delta to customer; adjust down or shift to new seller)
 * 4. New Price == Old Price (size/color swap)
 */
export const createExchange = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, orderNumber, productId, newProductId, newVariantId, reason } = req.body;

  if (!newProductId) {
    res.status(400).json({ error: "newProductId is required to process an exchange" });
    return;
  }
  if (!orderId && !orderNumber) {
    res.status(400).json({ error: "orderId or orderNumber is required to process an exchange" });
    return;
  }

  const include = { items: { include: { product: true } }, seller: { include: { onboarding: true } } } as const;
  const order = orderId
    ? await prisma.order.findUnique({ where: { id: orderId }, include })
    : await prisma.order.findUnique({ where: { orderNumber }, include });

  if (!order) {
    res.status(404).json({ error: "Original order not found for exchange" });
    return;
  }

  const ownershipError = await checkOrderOwnership(order.orderNumber, req.user?.id);
  if (ownershipError) {
    res.status(403).json({ error: ownershipError });
    return;
  }

  // An order can be exchanged once; repeating the call must not refund or claw back again.
  const exchangeClaim = await prisma.order.updateMany({
    where: { id: order.id, status: { notIn: ["EXCHANGE", "RETURNED", "CANCELLED"] as any } },
    data: { status: "EXCHANGE" as any },
  });
  if (exchangeClaim.count === 0) {
    res.status(409).json({ success: false, error: "This order has already been exchanged, returned or cancelled" });
    return;
  }

  const newProduct = await prisma.product.findUnique({
    where: { id: newProductId },
    include: { variants: true },
  });

  if (!newProduct) {
    res.status(404).json({ error: "Replacement product not found in catalog" });
    return;
  }

  let origProdId = productId;
  if (!origProdId && order.items && order.items.length > 0) {
    origProdId = order.items[0].productId;
  }
  if (!origProdId) {
    origProdId = newProduct.id;
  }

  const oldPrice = Number(order.totalAmount);
  const newPrice = Number(newProduct.price);
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

  res.status(201).json({
    success: true,
    autoApproved: true,
    message: "Exchange request approved and processed automatically without seller approval delay.",
    data: ret,
    reverseDetails,
    routingSummary,
    clawbackResult,
    customerRefundResult,
  });
});

