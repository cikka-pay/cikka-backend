import { Router } from "express";
import {
  customerSendOtp,
  customerVerifyOtp,
  getCustomerMe,
} from "../controllers/customer-auth.controller";
import { requireCustomerAuth } from "../middleware/auth.middleware";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const phoneSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
});

const otpSchema = phoneSchema.extend({
  otp: z.string().length(6, "OTP must be 6 digits"),
});

// Mobile App Customer Authentication Routes
router.post("/send-otp", validate({ body: phoneSchema }), customerSendOtp);
router.post("/verify-otp", validate({ body: otpSchema }), customerVerifyOtp);

// Protected Customer Profile Route
router.get("/me", requireCustomerAuth, getCustomerMe);

export default router;
