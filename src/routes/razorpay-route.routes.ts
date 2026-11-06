import { Router } from "express";
import {
  handleRouteWebhook,
  triggerRouteDisburse,
  createLinkedAccountHandler,
  processEligibleSettlementsHandler,
} from "../controllers/razorpay-route.controller";
import { requireAdminAuth } from "../middleware/auth.middleware";

const router = Router();

// Razorpay webhook (payments + Route events). Authenticated by X-Razorpay-Signature, no JWT.
router.post("/webhook", handleRouteWebhook);

// Everything below moves money or provisions accounts: admin panel token required.
router.use(requireAdminAuth);

// Disburse or release hold for a specific settlement ID
router.post("/disburse/:id", triggerRouteDisburse);

// Process and release all eligible T+7 holds automatically
router.post("/process-eligible-holds", processEligibleSettlementsHandler);
router.post("/process-eligible", processEligibleSettlementsHandler);

// Provision or re-sync a seller's linked account (sellerId in the body)
router.post("/create-account", createLinkedAccountHandler);

export default router;

/** Mounted at /webhooks/razorpay: only the webhook, at "/" and the legacy "/webhook". */
export const razorpayWebhookRouter = Router();
razorpayWebhookRouter.post("/", handleRouteWebhook);
razorpayWebhookRouter.post("/webhook", handleRouteWebhook);
