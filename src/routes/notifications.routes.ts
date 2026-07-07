import { Router } from "express";
import { getNotifications, markAsRead, markAllAsRead } from "../controllers/notifications.controller";

const router = Router();

router.get("/", getNotifications);
router.post("/mark-all-read", markAllAsRead);
router.patch("/:id/read", markAsRead);

export default router;
