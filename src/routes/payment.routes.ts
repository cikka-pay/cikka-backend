import { Router } from "express";
import { createOrder, verifyPayment, processCustomPayment } from "../controllers/payment.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

// Allow seamless checkout for both authenticated users and guest checkouts
router.use(optionalUserAuth);

// Create Razorpay payment order
router.post("/create-order", createOrder);

// Verify Razorpay payment signature
router.post("/verify-payment", verifyPayment);

// Process customizable in-app payment directly via Razorpay REST API (no popup)
router.post("/process-custom", processCustomPayment);
router.post("/process-custom-payment", processCustomPayment);

export default router;
