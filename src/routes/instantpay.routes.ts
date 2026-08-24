import { Router } from "express";
import { verifyPan } from "../controllers/instantpay.controller";
import { validate } from "../middleware/validate.middleware";
import { verifyPanSchema } from "../validations/instantpay.validation";

const router = Router();

/**
 * POST /verify-pan
 * Perform instant PAN verification via InstantPay API.
 */
router.post("/verify-pan", validate({ body: verifyPanSchema }), verifyPan);

export default router;
