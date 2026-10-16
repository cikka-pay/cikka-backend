import { Router } from "express";
import {
  handleRouteWebhook,
  triggerRouteDisburse,
  createLinkedAccountHandler,
} from "../controllers/razorpay-route.controller";
import { requireAdminAuth } from "../middleware/auth.middleware";

const router = Router();

// Public Webhook for Razorpay Route events
router.post("/webhook", handleRouteWebhook);

// Operator actions — admin token required (they move money / create payout accounts).
// Disburse or release hold for a specific settlement ID
router.post("/disburse/:id", requireAdminAuth, triggerRouteDisburse);

// Provision or re-sync linked account
router.post("/create-account", requireAdminAuth, createLinkedAccountHandler);

export default router;
