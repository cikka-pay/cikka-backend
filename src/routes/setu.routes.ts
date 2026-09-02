import { Router } from "express";
import { getPaymentStatus, processRefund, checkStatus, generatePaymentLink } from "../controllers/setu.controller";
import { requireSetuAuth, requireSetuIpWhitelist } from "../middleware/setu-auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  getPaymentStatusSchema,
  processRefundSchema,
  setuCheckStatusSchema,
  generatePaymentLinkSchema,
} from "../validations/setu.validation";

const router = Router();

// Apply Setu Webhook Auth & IP Whitelisting to all Setu routes
router.use(requireSetuAuth);
router.use(requireSetuIpWhitelist);

/**
 * Endpoint: POST /setu/v1/generatePaymentLink
 * Generate Payment Link URL requested by Setu WL + Custom Payment UI
 */
router.post("/generatePaymentLink", validate({ body: generatePaymentLinkSchema }), generatePaymentLink);

/**
 * Endpoint: POST /setu/v1/checkStatus & GET /setu/v1/checkStatus
 * Check Status URL specified in Whitelabel + Custom implementation documentation.
 */
router.post("/checkStatus", validate({ body: setuCheckStatusSchema }), checkStatus);
router.get("/checkStatus", checkStatus);

/**
 * Endpoint: POST /setu/v1/getPaymentStatus
 * Requirements:
 * - Respond within 30 seconds
 * - Idempotent, dedup check on uniquePaymentRefID
 */
router.post("/getPaymentStatus", validate({ body: getPaymentStatusSchema }), getPaymentStatus);

/**
 * Endpoint: POST /setu/v1/refund
 * Requirements:
 * - Same idempotency rules apply
 */
router.post("/refund", validate({ body: processRefundSchema }), processRefund);

export default router;



