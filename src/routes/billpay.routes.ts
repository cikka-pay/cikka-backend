import { Router } from "express";
import { requireUserAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { createBillpaySessionSchema } from "../validations/billpay.validation";
import { createBillpaySession } from "../controllers/billpaySession.controller";

// Setu BillPay pre-built screens (spec 002). Mounted at /api/bbps.
const router = Router();

router.post("/session", requireUserAuth, validate({ body: createBillpaySessionSchema }), createBillpaySession);

export default router;
