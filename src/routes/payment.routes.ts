import { Router } from "express";
import { createOrder, verifyPayment } from "../controllers/payment.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

// Allow seamless checkout for both authenticated users and guest checkouts
router.use(optionalUserAuth);

// Create Razorpay payment order
router.post("/create-order", createOrder);

// Verify Razorpay payment signature
router.post("/verify-payment", verifyPayment);

export default router;
