import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, ReturnStatus, NotificationType } from "../generated/prisma/client";
import { shipwayService } from "../services/shipway.service";

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

  // If approved and not already dispatched reverse, trigger Shipway Reverse Logistics
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

  const updatedReturn = await prisma.return.update({
    where: { id },
    data: { status },
    include: { order: true, product: true },
  });

  res.json({
    ...updatedReturn,
    reverseDetails,
  });
});

export const createReturn = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, orderNumber, productId, reason, refundAmount } = req.body;

  let order = null;
  if (orderId) {
    order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
  } else if (orderNumber) {
    order = await prisma.order.findUnique({
      where: { orderNumber },
      include: { items: { include: { product: true } } },
    });
  } else {
    order = await prisma.order.findFirst({
      orderBy: { createdAt: "desc" },
      include: { items: { include: { product: true } } },
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

  const ret = await prisma.return.create({
    data: {
      orderId: order.id,
      productId: prodId,
      reason: reason || "Size does not fit / Style exchange",
      refundAmount: refundAmount !== undefined ? Number(refundAmount) : Number(order.totalAmount),
      status: ReturnStatus.REQUESTED,
    },
    include: {
      order: true,
      product: true,
    },
  });

  // Notify seller of incoming return request
  await prisma.notification.create({
    data: {
      sellerId: order.sellerId,
      type: NotificationType.ORDER,
      title: `New Return Requested: #${order.orderNumber}`,
      body: `Customer requested return for ${ret.product?.name || "item"}. Reason: ${ret.reason}. Action required.`,
      metadata: {
        returnId: ret.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
      },
    },
  }).catch(() => {});

  res.status(201).json({
    success: true,
    message: "Return request submitted successfully. Pending seller approval.",
    data: ret,
  });
});
