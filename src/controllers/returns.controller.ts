import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, ReturnStatus, NotificationType } from "../generated/prisma/client";
import { shipwayService } from "../services/shipway.service";
import { razorpayService } from "../services/razorpay.service";
import { orderOwnerId } from "../services/mallPricing.service";
import {
  findOrderSettlement,
  findOrderPaymentId,
  reverseOrderTransferOnce,
  checkExchangeEligibility,
  eligibilityResponse,
  executeExchange,
  ExchangeError,
} from "../services/returns.service";

/**
 * Orders may only be returned / exchanged by the buyer who owns them (Order.userId, else the
 * user recorded on the Razorpay checkout). Returns an error message, or null when allowed.
 */
async function checkOrderOwnership(order: { userId?: string | null; orderNumber: string }, userId?: string): Promise<string | null> {
  const owner = await orderOwnerId(order);
  if (owner && owner !== userId) return "This order belongs to another account";
  return null;
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

  const ownershipError = await checkOrderOwnership(order, req.user?.id);
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
 * GET|POST /api/returns/exchange/eligibility
 * Pre-check before the app takes any payment for an exchange (spec 003 §10).
 * Query/body: orderId | orderNumber, newProductId, newVariantId?
 */
export const exchangeEligibility = asyncHandler(async (req: Request, res: Response) => {
  const src = { ...(req.query as any), ...(req.body || {}) };
  const result = await checkExchangeEligibility(req.user!.id, {
    orderId: src.orderId ?? src.order_id,
    orderNumber: src.orderNumber ?? src.order_number,
    newProductId: src.newProductId ?? src.new_product_id,
    newVariantId: src.newVariantId ?? src.new_variant_id,
  });
  res.status(200).json({ success: true, ...eligibilityResponse(result) });
});

/**
 * POST /api/returns/exchange
 * Automated exchange (zero seller approval). Eligibility is checked first; an upgrade
 * (new price > old) must be paid through checkout with `exchange: { orderId }`, which files
 * the exchange during fulfilment. A repeat call for an exchange already filed by checkout
 * answers 200 with `already_processed: true`.
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

  try {
    const result = await executeExchange({
      userId: req.user?.id ?? null,
      orderId,
      orderNumber,
      newProductId: String(newProductId),
      newVariantId,
      productId,
      reason,
    });
    res.status(201).json({
      success: true,
      autoApproved: true,
      message: "Exchange request approved and processed automatically without seller approval delay.",
      data: result.ret,
      reverseDetails: result.reverseDetails,
      routingSummary: result.routingSummary,
      clawbackResult: result.clawbackResult,
      customerRefundResult: result.customerRefundResult,
    });
  } catch (err) {
    if (!(err instanceof ExchangeError)) throw err;
    // Already filed by the exchange checkout for this user: idempotent success for the app.
    if (err.code === "EXCHANGE_NOT_ELIGIBLE") {
      const filed = await findExchangeFiledByCheckout(req.user?.id ?? null, orderId, orderNumber, String(newProductId));
      if (filed) {
        res.status(200).json({ success: true, already_processed: true, message: "Exchange already filed with your payment.", data: filed });
        return;
      }
    }
    res.status(err.status).json({ success: false, error: err.message, code: err.code, ...(err.details || {}) });
  }
});

/** The exchange a FULFILLED exchange checkout already filed for this user/order/product. */
async function findExchangeFiledByCheckout(userId: string | null, orderId?: string, orderNumber?: string, newProductId?: string) {
  if (!userId) return null;
  const order = orderId
    ? await prisma.order.findUnique({ where: { id: String(orderId) } })
    : await prisma.order.findUnique({ where: { orderNumber: String(orderNumber) } });
  if (!order || order.status !== "EXCHANGE") return null;
  const checkout = await prisma.razorpayCheckout.findFirst({
    where: {
      userId,
      status: "FULFILLED",
      snapshot: { path: ["pricing", "exchange", "orderId"], equals: order.id },
    },
  });
  if (!checkout) return null;
  const lines = ((checkout.snapshot as any)?.pricing?.lines || []) as Array<{ productId: string }>;
  if (newProductId && !lines.some((l) => l.productId === newProductId)) return null;
  return (checkout.result as any)?.exchange ?? { order_number: order.orderNumber };
}
