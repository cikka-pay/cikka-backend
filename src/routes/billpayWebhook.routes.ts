import { Router } from "express";
import { receiveBillpayWebhook } from "../controllers/billpayWebhook.controller";

// Mounted at /api/webhooks/setu/billpay. Auth is the X-BILL-WEBHOOK-API-KEY header
// (checked in the controller), not a user JWT.
const router = Router();

// POST /api/webhooks/setu/billpay — Setu BillPay events (spec 002)
router.post("/", receiveBillpayWebhook);

export default router;
