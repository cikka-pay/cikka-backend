import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { OrderStatus } from "@prisma/client";

export const listOrders = asyncHandler(async (req, res) => {
  const status = (req.query.status as string) || "all";
  const limit = Math.min(Number(req.query.limit) || 10, 100);

  if (status === "returns") {
    const returns = await prisma.return.findMany({
      where: { order: { sellerId: req.seller.id } },
      include: { order: true, product: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json(
      returns.map((r) => ({
        id: r.id,
        orderNumber: r.order.orderNumber,
        customerName: r.order.customerName,
        productName: r.product.name,
        status: r.status,
        refundAmount: r.refundAmount,
        createdAt: r.createdAt,
      }))
    );
    return;
  }

  const where: { sellerId: string; status?: OrderStatus } = { sellerId: req.seller.id };
  if (status === "pending") where.status = OrderStatus.PENDING;

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  res.json(orders);
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, sellerId: req.seller.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(order);
});
