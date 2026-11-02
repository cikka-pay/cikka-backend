import { Router } from "express";
import { getPaymentStatus, processRefund, checkStatus } from "../controllers/setu.controller";
import { requireSetuAuth, requireSetuIpWhitelist } from "../middleware/setu-auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  getPaymentStatusSchema,
  processRefundSchema,
  setuCheckStatusSchema,
} from "../validations/setu.validation";

const router = Router();

const setuAuthGuard = [requireSetuAuth, requireSetuIpWhitelist];

/**
 * Endpoint: POST /setu/v1/checkStatus & GET /setu/v1/checkStatus
 * Check Status URL specified in Whitelabel + Custom implementation documentation.
 */
router.post("/checkStatus", ...setuAuthGuard, validate({ body: setuCheckStatusSchema }), checkStatus);
router.get("/checkStatus", ...setuAuthGuard, checkStatus);

/**
 * Endpoint: POST /setu/v1/getPaymentStatus
 * Requirements:
 * - Respond within 30 seconds
 * - Idempotent, dedup check on uniquePaymentRefID
 */
router.post("/getPaymentStatus", ...setuAuthGuard, validate({ body: getPaymentStatusSchema }), getPaymentStatus);

/**
 * Endpoint: POST /setu/v1/refund
 * Requirements:
 * - Same idempotency rules apply
 */
router.post("/refund", ...setuAuthGuard, validate({ body: processRefundSchema }), processRefund);

/**
 * Endpoints for Setu Bridge "Step 2 — Test bill fetch and notifications"
 */
import { handleBillsFetch, handleBillsFetchReceipt, handleNotifications } from "../controllers/setu.controller";
router.post("/bills/fetch", handleBillsFetch);
router.post("/fetch", handleBillsFetch);
router.post("/bills/fetchReceipt", handleBillsFetchReceipt);
router.post("/fetchReceipt", handleBillsFetchReceipt);
router.post("/notifications", handleNotifications);
router.get("/notifications", (_req, res) => res.json({ status: "ok" }));

export default router;


