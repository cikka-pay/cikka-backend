import { Router } from "express";
import {
  signupSendPhoneOtp,
  signupVerifyPhoneOtp,
  signupSendEmailOtp,
  signupVerifyEmailOtp,
  signupSetPassword,
  signinSendOtp,
  signinVerifyOtp,
  forgotPasswordSendOtp,
  forgotPasswordVerifyOtp,
  forgotPasswordReset,
  getMe,
  login,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

// Zod schemas for validation
const phoneSchema = z.object({
  phone: z.string().regex(/^\+91\d{10}$/, "Invalid Indian phone number format (+91XXXXXXXXXX)"),
});
const phoneOtpSchema = phoneSchema.extend({
  otp: z.string().length(6, "OTP must be 6 digits"),
});
const emailSchema = z.object({
  email: z.string().email("Invalid email format"),
});
const emailOtpSchema = emailSchema.extend({
  otp: z.string().length(6, "OTP must be 6 digits"),
});
const passwordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  loginId: z.string().min(1, "Login ID is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Signup Flow
router.post("/signup/send-phone-otp", validate({ body: phoneSchema }), signupSendPhoneOtp);
router.post("/signup/verify-phone-otp", validate({ body: phoneOtpSchema }), signupVerifyPhoneOtp);

// The next steps require the temporary signupToken (JWT) issued by phone verification
router.post("/signup/send-email-otp", requireAuth, validate({ body: emailSchema }), signupSendEmailOtp);
router.post("/signup/verify-email-otp", requireAuth, validate({ body: emailOtpSchema }), signupVerifyEmailOtp);
router.post("/signup/set-password", requireAuth, validate({ body: passwordSchema }), signupSetPassword);

// Signin Flow (Phone OTP)
router.post("/signin/send-otp", validate({ body: phoneSchema }), signinSendOtp);
router.post("/signin/verify-otp", validate({ body: phoneOtpSchema }), signinVerifyOtp);

// Forgot Password Flow
router.post("/forgot-password/send-otp", validate({ body: phoneSchema }), forgotPasswordSendOtp);
router.post("/forgot-password/verify-otp", validate({ body: phoneOtpSchema }), forgotPasswordVerifyOtp);
// Reset requires the resetToken (JWT) issued by verify-otp
router.post("/forgot-password/reset", requireAuth, validate({ body: passwordSchema }), forgotPasswordReset);

// Current User
router.get("/me", requireAuth, getMe);

// Password Login (loginId + password — no OTP required)
router.post("/login", validate({ body: loginSchema }), login);

export default router;
