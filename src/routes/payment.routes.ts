import { Router } from "express";
import { createOrder, verifyPayment } from "../controllers/payment.controller";
import { requireAnyAuth } from "../middleware/auth.middleware";

const router = Router();

// Protect Razorpay payment endpoints — require Seller or User JWT
router.use(requireAnyAuth);

// Create Razorpay payment order
router.post("/create-order", createOrder);

// Verify Razorpay payment signature
router.post("/verify-payment", verifyPayment);

export default router;
