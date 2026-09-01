import { Router } from "express";
import { verifyPan, verifyGstin, verifyCin } from "../controllers/instantpay.controller";
import { validate } from "../middleware/validate.middleware";
import { verifyPanSchema } from "../validations/instantpay.validation";
import { verifyGstinSchema } from "../validations/gstin.validation";
import { verifyCinSchema } from "../validations/cin.validation";

const router = Router();

/**
 * POST /verify-pan
 * Perform instant PAN verification via InstantPay API.
 */
router.post("/verify-pan", validate({ body: verifyPanSchema }), verifyPan);

/**
 * POST /verify-gstin
 * Perform instant GSTIN verification via InstantPay API.
 */
router.post("/verify-gstin", validate({ body: verifyGstinSchema }), verifyGstin);

/**
 * POST /verify-cin
 * Perform instant MCA CIN verification via InstantPay fetchCIN API.
 */
router.post("/verify-cin", validate({ body: verifyCinSchema }), verifyCin);

export default router;
