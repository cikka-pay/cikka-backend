import { Router } from "express";
import { createOrder, verifyPayment } from "../controllers/payment.controller";

const router = Router();

// Create Razorpay payment order
router.post("/create-order", createOrder);

// Verify Razorpay payment signature
router.post("/verify-payment", verifyPayment);

export default router;
