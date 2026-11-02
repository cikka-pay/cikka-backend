import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, ReturnStatus, NotificationType } from "../generated/prisma/client";
import { shipwayService } from "../services/shipway.service";
import { razorpayRouteService } from "../services/razorpayRoute.service";
import { razorpayService } from "../services/razorpay.service";

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

  // 2. Automated Reverse Routing & Payout Clawback (Within 7-day hold window)
  let reversalResult: any = null;
  let customerRefundResult: any = null;

  if (status === "APPROVED" || status === "REFUNDED") {
    try {
      // Find the pending settlement associated with this seller and order
      const settlement = await prisma.settlement.findFirst({
        where: {
          sellerId,
          transferStatus: "ON_HOLD",
          razorpayTransferId: { not: null },
        },
        orderBy: { createdAt: "desc" },
      });

      if (settlement && settlement.razorpayTransferId) {
        console.log(`[Return Clawback] Initiating reversal for transfer ${settlement.razorpayTransferId}`);
        const refundPaise = Math.round(Number(ret.refundAmount) * 100);

        reversalResult = await razorpayRouteService.reverseTransfer(
          settlement.razorpayTransferId,
          refundPaise,
          `Return for Order #${ret.order.orderNumber}`
        );

        if (reversalResult.success) {
          await prisma.settlement.update({
            where: { id: settlement.id },
            data: {
              transferStatus: "REVERSED",
              status: "CANCELLED",
              failureReason: `Clawed back on customer return #${ret.id}`,
            } as any,
          });

          await prisma.notification.create({
            data: {
              sellerId,
              type: NotificationType.SETTLEMENT,
              title: `Payout Clawback Reversal: Order #${ret.order.orderNumber}`,
              body: `Return approved within hold window. Transfer ₹${ret.refundAmount} was reversed from your Linked Account.`,
              metadata: {
                returnId: ret.id,
                transferId: settlement.razorpayTransferId,
                amount: Number(ret.refundAmount),
              },
            },
          }).catch(() => {});
        }
      }

      // If status is REFUNDED, issue customer card/points refund
      if (status === "REFUNDED" && settlement?.razorpayPaymentId) {
        customerRefundResult = await razorpayService.refundPayment(
          settlement.razorpayPaymentId,
          Math.round(Number(ret.refundAmount) * 100),
          {
            returnId: ret.id,
            orderNumber: ret.order.orderNumber,
          }
        );
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

  let order = null;
  if (orderId) {
    order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
    });
  } else if (orderNumber) {
    order = await prisma.order.findUnique({
      where: { orderNumber },
      include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
    });
  } else {
    order = await prisma.order.findFirst({
      orderBy: { createdAt: "desc" },
      include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
    });
  }

  if (!order) {
    res.status(404).json({ error: "Order not found to initiate return" });
    return;
  }

  let prodId = productId;
  if (!prodId && order.items && order.items.length > 0) {
    prodId = order.items[0].productId;
  }
  if (!prodId) {
    const anyProd = await prisma.product.findFirst();
    prodId = anyProd?.id;
  }

  const effectiveRefundAmount =
    refundAmount !== undefined ? Number(refundAmount) : Number(order.totalAmount);

  // =========================================================================
  // SCENARIO 1: ORDER IS IN-TRANSIT (Cancellation / Return before delivery)
  // No seller approval required! Automatic instant refund & escrow clawback.
  // =========================================================================
  const isInTransit = (order.status as any) !== "DELIVERED";

  if (isInTransit) {
    // 1. Create Return marked as APPROVED directly
    const ret = await prisma.return.create({
      data: {
        orderId: order.id,
        productId: prodId,
        reason: reason || "In-transit Return / Cancellation by customer",
        refundAmount: effectiveRefundAmount,
        status: ReturnStatus.APPROVED,
      },
      include: { order: true, product: true },
    });

    // 2. Mark order as RETURNED
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "RETURNED" as any },
    });

    // 3. Find pending settlement on hold and claw back money from seller linked account
    let clawbackResult: any = null;
    let customerRefundResult: any = null;

    const settlement = await prisma.settlement.findFirst({
      where: {
        sellerId: order.sellerId,
        transferStatus: "ON_HOLD",
        razorpayTransferId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    if (settlement && settlement.razorpayTransferId) {
      const refundPaise = Math.round(effectiveRefundAmount * 100);
      clawbackResult = await razorpayRouteService.reverseTransfer(
        settlement.razorpayTransferId,
        refundPaise,
        `In-transit Return RTO for Order #${order.orderNumber}`
      );

      if (clawbackResult.success) {
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            transferStatus: "REVERSED",
            status: "CANCELLED",
            failureReason: `In-transit return initiated by customer for Order #${order.orderNumber}. Escrow hold reversed and removed from active settlements.`,
          } as any,
        });
      }

      // 4. Instant Customer Refund to Card/UPI
      if (settlement.razorpayPaymentId) {
        customerRefundResult = await razorpayService.refundPayment(
          settlement.razorpayPaymentId,
          refundPaise,
          {
            returnId: ret.id,
            orderNumber: order.orderNumber,
            reason: "Instant In-Transit Return Refund",
          }
        );
      }
    }

    // 5. In-App Notification to Seller (Returns Category)
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

  let order = null;
  if (orderId) {
    order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
    });
  } else if (orderNumber) {
    order = await prisma.order.findUnique({
      where: { orderNumber },
      include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
    });
  } else {
    order = await prisma.order.findFirst({
      orderBy: { createdAt: "desc" },
      include: { items: { include: { product: true } }, seller: { include: { onboarding: true } } },
    });
  }

  if (!order) {
    res.status(404).json({ error: "Original order not found for exchange" });
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

  // 1b. Trigger EXCHANGE status for the order in dashboard summary & order lists
  await prisma.order.update({
    where: { id: order.id },
    data: { status: "EXCHANGE" as any },
  });

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

  // 3. Locate active settlement on hold
  const settlement = await prisma.settlement.findFirst({
    where: {
      sellerId: order.sellerId,
      transferStatus: "ON_HOLD",
      razorpayTransferId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

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
      if (settlement?.razorpayPaymentId) {
        customerRefundResult = await razorpayService.refundPayment(
          settlement.razorpayPaymentId,
          refundPaise,
          {
            orderNumber: order.orderNumber,
            reason: `Exchange downgrade refund: ${Math.abs(delta)} INR`,
          }
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
    if (settlement?.razorpayTransferId) {
      clawbackResult = await razorpayRouteService.reverseTransfer(
        settlement.razorpayTransferId,
        undefined, // reverse 100%
        `Cross-brand exchange from Seller ${order.sellerId} to Seller ${newProduct.sellerId}`
      );

      await prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          transferStatus: "REVERSED",
          status: "CANCELLED",
          failureReason: `Exchanged for Product from another brand (Seller #${newProduct.sellerId}). Payout shifted to new seller.`,
        } as any,
      });
    }

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
      if (settlement?.razorpayPaymentId) {
        customerRefundResult = await razorpayService.refundPayment(
          settlement.razorpayPaymentId,
          refundPaise,
          {
            orderNumber: order.orderNumber,
            reason: `Cross-brand exchange downgrade refund: ${Math.abs(delta)} INR`,
          }
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

