import { Router } from "express";
import {
  initiateRedemption,
  confirmRedemption,
} from "../controllers/rewards.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

// Allow authenticated users or guests with points session
router.use(optionalUserAuth);

// Step 1: Initiate redemption & create Razorpay order for ₹11.79 customer platform fee
router.post("/initiate-redemption", initiateRedemption);
router.post("/redeem/initiate", initiateRedemption);

// Step 2: Confirm redemption after ₹11.79 payment verification, allocate Cikka corporate funding on T+7 hold, and dispatch via Shipway
router.post("/confirm-redemption", confirmRedemption);
router.post("/redeem/confirm", confirmRedemption);

export default router;
