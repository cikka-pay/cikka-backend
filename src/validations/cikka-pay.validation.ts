import { z } from "zod";

export const validateCustomerSchema = z.object({
  billerId: z.string().min(1, "billerId is required"),
  customerParams: z.record(z.string(), z.any()),
});

export const fetchBillSchema = z.object({
  billerId: z.string().min(1, "billerId is required"),
  customerParams: z.record(z.string(), z.any()),
});

export const payBillSchema = z.object({
  platformBillId: z.string().min(1, "platformBillId is required"),
  amount: z.number().positive("amount must be greater than zero"),
  paymentMode: z.enum(["UPI", "DEBIT_CARD", "CREDIT_CARD", "NET_BANKING"]).default("UPI"),
  billerId: z.string().optional(),
  customerParams: z.record(z.string(), z.any()).optional(),
  idempotencyKey: z.string().optional(),
  // Proof of customer payment (required when real Setu services / production are in use)
  razorpay_order_id: z.string().min(1).optional(),
  razorpay_payment_id: z.string().min(1).optional(),
  razorpay_signature: z.string().min(1).optional(),
});
