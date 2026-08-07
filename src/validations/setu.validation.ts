import { z } from "zod";

export const getPaymentStatusSchema = z.object({
  uniquePaymentRefID: z.string().min(1, "uniquePaymentRefID is required"),
  status: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  userId: z.string().optional(),
  orderId: z.string().optional(),
  rawPayload: z.any().optional(),
});

export const processRefundSchema = z.object({
  uniquePaymentRefID: z.string().optional(),
  refundRefID: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  userId: z.string().optional(),
  orderId: z.string().optional(),
  rawPayload: z.any().optional(),
}).refine((data) => data.uniquePaymentRefID || data.refundRefID, {
  message: "Either uniquePaymentRefID or refundRefID must be provided",
  path: ["uniquePaymentRefID"],
});
