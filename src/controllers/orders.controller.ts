import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, OrderStatus } from "@prisma/client";
import { shipwayService } from "../services/shipway.service";

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { page = "1", limit = "10", status } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.OrderWhereInput = { sellerId };

  if (status && status !== "ALL") {
    where.status = status as OrderStatus;
  }

  const [data, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { product: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  res.json({
    data,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, sellerId: req.seller!.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(order);
});

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller?.id || (await prisma.seller.findFirst())?.id;
  if (!sellerId) {
    res.status(400).json({ error: "Seller ID is required to create order" });
    return;
  }

  const { customerName, customerCity, totalAmount, customerEmail, customerPhone, deliveryAddress } = req.body;
  const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

  const order = await prisma.order.create({
    data: {
      sellerId,
      orderNumber,
      customerName: customerName || "Cikka Mall Customer",
      customerCity: customerCity || "Mumbai",
      totalAmount: totalAmount || 32989,
      status: OrderStatus.PENDING,
    },
  });

  // Automatically push shipment to Shipway Experience
  shipwayService.pushOrderData({
    order_id: order.orderNumber,
    customer_name: order.customerName,
    customer_email: customerEmail || "customer@cikka.club",
    customer_phone: customerPhone || "9876543210",
    delivery_address: deliveryAddress || "123, Sample Street, Mumbai – 400001",
    total_amount: Number(order.totalAmount),
    carrier_name: "Bluedart",
    awb_number: `BD${Date.now().toString().slice(-8)}`,
  }).catch((err) => {
    console.warn(`[Shipway Push Notice] Order #${order.orderNumber} push error: ${err.message}`);
  });

  res.status(201).json({
    success: true,
    message: "Order created and pushed to Shipway Experience successfully",
    order,
  });
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const sellerId = req.seller!.id;
  const { status, trackingNumber, courier } = req.body;

  const order = await prisma.order.findFirst({
    where: { id, sellerId },
  });

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: {
      status,
      // Only update tracking fields when they're explicitly provided
      ...(trackingNumber !== undefined && { trackingNumber }),
      ...(courier !== undefined && { courier }),
    },
  });

  res.json(updatedOrder);
});
