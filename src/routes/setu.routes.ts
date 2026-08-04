import { Router } from "express";
import { getPaymentStatus, processRefund } from "../controllers/setu.controller";
import { requireSetuAuth, requireSetuIpWhitelist } from "../middleware/setu-auth.middleware";

const router = Router();


// Apply Setu Webhook Auth & IP Whitelisting to all Setu routes
router.use(requireSetuAuth);
router.use(requireSetuIpWhitelist);

/**
 * Endpoint: POST /setu/v1/getPaymentStatus
 * Requirements:
 * - Respond within 30 seconds
 * - Idempotent, dedup check on uniquePaymentRefID
 */
router.post("/getPaymentStatus", getPaymentStatus);

/**
 * Endpoint: POST /setu/v1/refund
 * Requirements:
 * - Same idempotency rules apply
 */
router.post("/refund", processRefund);

export default router;
