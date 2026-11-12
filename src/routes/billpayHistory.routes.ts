import { Router } from "express";
import { requireUserAuth } from "../middleware/auth.middleware";
import { getBillpayHistory, getBillpayHistoryById } from "../controllers/billpayHistory.controller";

// Mounted at /api/bbps (next to billpay.routes). Auth is per-route so this router
// doesn't put a JWT check in front of other /api/bbps routes.
const router = Router();

// GET /api/bbps/history      — caller's last 50 bill payments
router.get("/history", requireUserAuth, getBillpayHistory);

// GET /api/bbps/history/:id  — one of the caller's bill payments (404 otherwise)
router.get("/history/:id", requireUserAuth, getBillpayHistoryById);

export default router;
