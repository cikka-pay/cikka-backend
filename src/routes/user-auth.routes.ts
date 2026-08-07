import { Router } from "express";
import {
  userSendOtp,
  userVerifyOtp,
  getUserMe,
} from "../controllers/user-auth.controller";
import { requireUserAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { phoneSchema, otpSchema } from "../validations/user-auth.validation";

const router = Router();

// Mobile App User Authentication Routes
router.post("/send-otp", validate({ body: phoneSchema }), userSendOtp);
router.post("/verify-otp", validate({ body: otpSchema }), userVerifyOtp);

// Protected User Profile Route
router.get("/me", requireUserAuth, getUserMe);

export default router;

