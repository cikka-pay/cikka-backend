import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { getUserOrder, listUserOrders } from "../services/userOrders.service";

/** GET /api/user/orders/my-orders?status=&limit=&cursor=  — the signed-in buyer's orders only. */
export const listMyOrders = asyncHandler(async (req: Request, res: Response) => {
  const { orders, nextCursor } = await listUserOrders(req.user!.id, {
    status: typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined,
    limit: Number(req.query.limit) || undefined,
    cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
  });
  res.json({ success: true, orders, next_cursor: nextCursor });
});

/** GET /api/user/orders/:id  (order id or order number) — 404 unless it is the caller's. */
export const getMyOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await getUserOrder(req.user!.id, req.params.id);
  if (!order) {
    res.status(404).json({ success: false, error: "Order not found" });
    return;
  }
  res.json({ success: true, order });
});
