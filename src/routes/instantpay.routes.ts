import { Router } from "express";
import { verifyAadhaar, verifyBankAccount, verifyCin, verifyGstin, verifyPan, verifyVpa } from "../controllers/instantpay.controller";
import { requireAnyAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { aadhaarValidation } from "../validations/aadhaar.validation";
import { bankAccountValidation } from "../validations/bank-account.validation";
import { verifyCinSchema } from "../validations/cin.validation";
import { verifyGstinSchema } from "../validations/gstin.validation";
import { verifyPanSchema } from "../validations/instantpay.validation";
import { vpaValidation } from "../validations/vpa.validation";

const router = Router();

// Protect all InstantPay KYC endpoints — require Seller or User JWT
router.use(requireAnyAuth);

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

/**
 * POST /verify-aadhaar
 * Perform instant Aadhaar Demographic verification via InstantPay API.
 */
router.post("/verify-aadhaar", validate({ body: aadhaarValidation }), verifyAadhaar);

/**
 * POST /verify-vpa
 * Perform instant UPI VPA verification via InstantPay API.
 */
router.post("/verify-vpa", validate({ body: vpaValidation }), verifyVpa);

/**
 * POST /verify-bank-account
 * Perform instant Bank Account Penny Drop verification via InstantPay API.
 */
router.post("/verify-bank-account", validate({ body: bankAccountValidation }), verifyBankAccount);

export default router;
