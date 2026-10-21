import { Router } from "express";
import {
  handleRouteWebhook,
  triggerRouteDisburse,
  createLinkedAccountHandler,
  processEligibleSettlementsHandler,
} from "../controllers/razorpay-route.controller";

const router = Router();

// Public Webhook for Razorpay Route events
router.post("/webhook", handleRouteWebhook);

// Disburse or release hold for a specific settlement ID
router.post("/disburse/:id", triggerRouteDisburse);

// Process and release all eligible T+7 holds automatically
router.post("/process-eligible-holds", processEligibleSettlementsHandler);
router.post("/process-eligible", processEligibleSettlementsHandler);

// Provision or re-sync linked account
router.post("/create-account", createLinkedAccountHandler);

export default router;

