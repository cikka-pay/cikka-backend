import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, OrderStatus } from "@prisma/client";

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
