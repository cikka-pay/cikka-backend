import { Router } from "express";
import {
  userSendOtp,
  userResendOtp,
  userVerifyOtp,
  getUserMe,
  userUpdateProfile,
} from "../controllers/user-auth.controller";
import { requireUserAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { phoneSchema, otpSchema, resendOtpSchema } from "../validations/user-auth.validation";

const router = Router();

// Mobile App User Authentication Routes
router.post("/send-otp", validate({ body: phoneSchema }), userSendOtp);
router.post("/resend-otp", validate({ body: resendOtpSchema }), userResendOtp);
router.post("/verify-otp", validate({ body: otpSchema }), userVerifyOtp);

// Protected User Profile Routes
router.get("/me", requireUserAuth, getUserMe);
router.patch("/profile", requireUserAuth, userUpdateProfile);
router.put("/profile", requireUserAuth, userUpdateProfile);

export default router;


