import { Router } from "express";
import {
  getOnboardingState,
  getMerchantAgreement,
  updateStep1,
  updateStep2,
  verifyGst,
  verifyPan,
  verifyCin,
  updateStep3,
  sendAadhaarOtp,
  verifyAadhaarOtp,
  updateStep4,
  verifyBank,
  updateStep5,
  uploadLogo,
  updateStep6,
  submitApplication,
  validateDomain,
} from "../controllers/onboarding.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { uploadLogo as uploadLogoMiddleware } from "../middleware/upload.middleware";

const router = Router();

// Domain & URL validator utility (open to onboarding users)
router.post("/validate-domain", validateDomain);


// All other onboarding endpoints require the user to be authenticated
router.use(requireAuth);

router.get("/", getOnboardingState);
router.get("/agreement", getMerchantAgreement);
router.post("/submit", submitApplication);

// Step 1: Business Info
router.patch("/step/1", updateStep1);

// Step 2: Legal / KYB
router.patch("/step/2", updateStep2);
router.post("/kyb/verify-gst", verifyGst);
router.post("/kyb/verify-pan", verifyPan);
router.post("/kyb/verify-cin", verifyCin);

// Step 3: Authorized Signatory
router.patch("/step/3", updateStep3);
router.post("/kyb/send-aadhaar-otp", sendAadhaarOtp);
router.post("/kyb/verify-aadhaar-otp", verifyAadhaarOtp);

// Step 4: Bank Account
router.patch("/step/4", updateStep4);
router.post("/kyb/verify-bank", verifyBank);

// Step 5: Brand & Logistics
router.patch("/step/5", updateStep5);
// Logo upload — multer parses multipart/form-data, populates req.file
router.post("/upload/logo", uploadLogoMiddleware, uploadLogo);


// Step 6: Agreements
router.patch("/step/6", updateStep6);

export default router;
