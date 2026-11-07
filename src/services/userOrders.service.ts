/**
 * Buyer-facing order history (spec 003 §6). Every query is scoped to Order.userId = the
 * authenticated user; orders are never looked up by phone or name.
 */
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

const STATUS_TEXT: Record<string, [string, string]> = {
  PENDING: ["Order placed", "The seller is preparing your order"],
  PACKED: ["Packed", "Ready to be picked up by the courier"],
  SHIPPED: ["In transit", "Your order is on its way"],
  DELIVERED: ["Delivered", "Your order was delivered"],
  CANCELLED: ["Cancelled", "This order was cancelled"],
  RETURNED: ["Returned", "Refund issued to your original payment method"],
  EXCHANGE: ["Exchange in progress", "Your replacement is being arranged"],
};

const include = {
  items: { include: { product: { select: { id: true, name: true, brandName: true, imageUrls: true } } } },
  seller: { select: { businessName: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof include }>;

function firstImage(urls: unknown): string | null {
  if (Array.isArray(urls)) return (urls.find((u) => typeof u === "string") as string) ?? null;
  if (typeof urls === "string") {
    try {
      const parsed = JSON.parse(urls);
      if (Array.isArray(parsed)) return parsed[0] ?? null;
    } catch {
      return urls;
    }
  }
  return null;
}

export function toUserOrderView(order: OrderRow) {
  const item = order.items[0];
  const [statusText, statusSubtext] = STATUS_TEXT[order.status] || [order.status, ""];
  const total = Number(order.totalAmount);
  const deliveredAt = order.deliveredAt;
  return {
    id: order.orderNumber,
    internalId: order.id,
    title: item?.product?.name || "Cikka Mall order",
    brand: item?.product?.brandName || order.seller?.businessName || "",
    variant: item?.variantId || "",
    image: firstImage(item?.product?.imageUrls) || "",
    price: `₹${total.toLocaleString("en-IN")}`,
    totalAmount: total,
    date: order.createdAt.toISOString(),
    deliveredDate: deliveredAt ? deliveredAt.toISOString() : undefined,
    returnWindowEnded: deliveredAt ? Date.now() > deliveredAt.getTime() + 7 * 86400000 : false,
    status: order.status,
    statusText,
    statusSubtext,
    courier: order.courier || "",
    trackingNumber: order.trackingNumber || undefined,
    canCancel: order.status === "PENDING" || order.status === "PACKED",
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.product?.name || "",
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
    })),
  };
}

export async function listUserOrders(userId: string, opts: { status?: string; limit?: number; cursor?: string } = {}) {
  const where: Prisma.OrderWhereInput = { userId };
  if (opts.status && opts.status !== "ALL") where.status = opts.status as any;
  const take = Math.min(Math.max(opts.limit || 50, 1), 100);
  const rows = await prisma.order.findMany({
    where,
    include,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const nextCursor = rows.length > take ? rows.pop()!.id : null;
  return { orders: rows.map(toUserOrderView), nextCursor };
}

export async function getUserOrder(userId: string, idOrNumber: string) {
  const row = await prisma.order.findFirst({
    where: { userId, OR: [{ id: idOrNumber }, { orderNumber: idOrNumber }] },
    include,
  });
  return row ? toUserOrderView(row) : null;
}
