import { Router } from "express";
import {
  handleRouteWebhook,
  triggerRouteDisburse,
  createLinkedAccountHandler,
} from "../controllers/razorpay-route.controller";

const router = Router();

// Public Webhook for Razorpay Route events
router.post("/webhook", handleRouteWebhook);

// Disburse or release hold for a specific settlement ID
router.post("/disburse/:id", triggerRouteDisburse);

// Provision or re-sync linked account
router.post("/create-account", createLinkedAccountHandler);

export default router;
