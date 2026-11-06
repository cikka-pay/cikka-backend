import { Router } from "express";
import {
  createOrder,
  verifyPayment,
  payWithCard,
  verifyCardOtp,
} from "../controllers/payment.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

// Allow seamless checkout for both authenticated users and guest checkouts
router.use(optionalUserAuth);

// Create Razorpay payment order
router.post("/create-order", createOrder);

// Verify Razorpay payment signature
router.post("/verify-payment", verifyPayment);

// Dedicated Tokenized Card Checkout (Bank 3DS OTP Authentication)
router.post("/pay-with-card", payWithCard);
router.post("/verify-card-otp", verifyCardOtp);

export default router;
