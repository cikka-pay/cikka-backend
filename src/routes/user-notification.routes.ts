import { Router } from "express";
import { requireUserAuth } from "../middleware/auth.middleware";
import {
  getUserNotifications,
  markUserNotificationAsRead,
  markAllUserNotificationsAsRead,
  deleteUserNotification,
} from "../controllers/user-notification.controller";

const router = Router();

router.use(requireUserAuth);

// GET /api/user-notifications — list notifications with unread count
router.get("/", getUserNotifications);

// POST /api/user-notifications/read-all — mark all as read
router.post("/read-all", markAllUserNotificationsAsRead);

// PATCH /api/user-notifications/:id/read — mark single notification as read
router.patch("/:id/read", markUserNotificationAsRead);

// DELETE /api/user-notifications/:id — delete notification
router.delete("/:id", deleteUserNotification);

export default router;
