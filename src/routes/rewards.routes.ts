import { Router } from "express";
import {
  initiateRedemption,
  confirmRedemption,
  payWithCardForRewards,
  verifyCardOtpForRewards,
  getUserRewardBalance,
  getCikkaPayRewardEstimate,
} from "../controllers/rewards.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

// Allow authenticated users or guests with points session
router.use(optionalUserAuth);

// Cikka Pay Real-Time Rewards Estimation
router.get("/estimate", getCikkaPayRewardEstimate);
router.get("/cikka-pay/estimate", getCikkaPayRewardEstimate);

// CI Points Balance inquiry
router.get("/balance", getUserRewardBalance);
router.get("/user/balance", getUserRewardBalance);

// Step 1: Initiate redemption & create Razorpay order for ₹11.79 customer platform fee (or ₹61.79 express)
router.post("/initiate-redemption", initiateRedemption);
router.post("/redeem/initiate", initiateRedemption);

// Step 2: Confirm redemption after standard Razorpay payment verification
router.post("/confirm-redemption", confirmRedemption);
router.post("/redeem/confirm", confirmRedemption);

// Tokenized Saved Credit Card Checkout Flow
router.post("/pay-with-card", payWithCardForRewards);
router.post("/verify-card-otp", verifyCardOtpForRewards);

export default router;
