import { Router } from "express";
import {
  getOnboardingState,
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
} from "../controllers/onboarding.controller";
import { requireAuth } from "../middleware/auth.middleware";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

// Configure multer disk storage for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// All onboarding endpoints require the user to be authenticated
router.use(requireAuth);

router.get("/", getOnboardingState);
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
router.post("/upload/logo", upload.single("logo"), uploadLogo);

// Step 6: Agreements
router.patch("/step/6", updateStep6);

export default router;
