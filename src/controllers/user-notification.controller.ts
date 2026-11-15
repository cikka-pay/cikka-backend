import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { isExcludedUserNotification } from "../utils/userNotifications";

export const getUserNotifications = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const category = req.query.category as string | undefined;

  const whereClause: any = { userId };
  if (category && category !== "all") {
    whereClause.category = category;
  }

  const allMatching = await prisma.userNotification.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    take: Math.max(limit * 4, 100),
  });

  const visibleNotifications = allMatching.filter(
    (n) => !isExcludedUserNotification(n),
  );
  const unreadCount = visibleNotifications.filter((n) => !n.read).length;
  const notifications = visibleNotifications.slice(0, limit);

  const formatted = notifications.map((n) => ({
    id: n.id,
    category: n.category,
    title: n.title,
    desc: n.body,
    time: formatTimeAgo(n.createdAt),
    read: n.read,
    metadata: n.metadata,
    created_at: n.createdAt.toISOString(),
  }));

  res.status(200).json({
    success: true,
    data: formatted,
    meta: {
      unreadCount,
    },
  });
});

export const markUserNotificationAsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const { id } = req.params;

  const notification = await prisma.userNotification.findFirst({
    where: { id, userId },
  });

  if (!notification) {
    res.status(404).json({ success: false, error: "Notification not found" });
    return;
  }

  const updated = await prisma.userNotification.update({
    where: { id },
    data: { read: true },
  });

  res.status(200).json({
    success: true,
    data: updated,
  });
});

export const markAllUserNotificationsAsRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const result = await prisma.userNotification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });

  res.status(200).json({
    success: true,
    count: result.count,
  });
});

export const deleteUserNotification = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const { id } = req.params;

  await prisma.userNotification.deleteMany({
    where: { id, userId },
  });

  res.status(200).json({
    success: true,
    message: "Notification removed",
  });
});

function formatTimeAgo(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}
