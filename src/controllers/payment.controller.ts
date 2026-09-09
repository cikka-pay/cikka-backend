import { Request, Response } from "express";
import { razorpayService } from "../services/razorpay.service";
import { shipwayService } from "../services/shipway.service";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * POST /api/payment/create-order
 * POST /api/create-order
 * Create a new Razorpay order for Cikka Mall purchases.
 */
export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const { amount, currency, receipt, notes } = req.body;

  if (amount === undefined || amount === null || isNaN(Number(amount))) {
    res.status(400).json({
      success: false,
      error: "Amount in paise is required and must be a valid number",
    });
    return;
  }

  const result = await razorpayService.createOrder({
    amount: Number(amount),
    currency,
    receipt,
    notes,
  });

  res.status(200).json({
    success: true,
    message: "Razorpay order created successfully",
    ...result,
  });
});

/**
 * POST /api/payment/verify-payment
 * POST /api/verify-payment
 * Verify Razorpay payment signature after customer completes payment.
 */
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, customer_name, customer_email, customer_phone, delivery_address, amount } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature",
    });
    return;
  }

  const isValid = razorpayService.verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!isValid) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Invalid payment signature",
    });
    return;
  }

  // Push order data to Shipway Experience automatically post-payment
  shipwayService.pushOrderData({
    order_id: razorpay_order_id,
    customer_name: customer_name || "Cikka Mall Customer",
    customer_email: customer_email || "customer@cikka.club",
    customer_phone: customer_phone || "9876543210",
    delivery_address: delivery_address || "123, Sample Street, Mumbai – 400001",
    total_amount: amount ? Number(amount) / 100 : 32989,
    carrier_name: "Bluedart",
    awb_number: `BD${Date.now().toString().slice(-8)}`,
  }).catch((err) => {
    console.warn(`[Shipway Push Notice] Asynchronous push error: ${err.message}`);
  });

  res.status(200).json({
    success: true,
    verified: true,
    message: "Payment signature verified successfully",
    payment_id: razorpay_payment_id,
    order_id: razorpay_order_id,
  });
});

