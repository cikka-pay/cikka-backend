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

export const setuCheckStatusSchema = z.object({
  uniquePaymentRefID: z.string().optional(),
  refID: z.string().optional(),
  setuTxnId: z.string().optional(),
}).refine((data) => data.uniquePaymentRefID || data.refID || data.setuTxnId, {
  message: "At least one reference ID (uniquePaymentRefID, refID, or setuTxnId) must be provided",
  path: ["uniquePaymentRefID"],
});

export const generatePaymentLinkSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional(),
  billerId: z.string().optional(),
  uniquePaymentRefID: z.string().optional(),
  refID: z.string().optional(),
  customerMobile: z.string().optional(),
  redirectUrl: z.string().optional(),
});


