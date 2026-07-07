import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  const notifications = await prisma.notification.findMany({
    where: { sellerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const unreadCount = await prisma.notification.count({
    where: { sellerId, read: false },
  });

  res.json({
    data: notifications,
    meta: {
      unreadCount,
    },
  });
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { id } = req.params;

  const notification = await prisma.notification.findFirst({
    where: { id, sellerId },
  });

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
  });

  res.json(updated);
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;

  const result = await prisma.notification.updateMany({
    where: { sellerId, read: false },
    data: { read: true },
  });

  res.json({ count: result.count });
});
