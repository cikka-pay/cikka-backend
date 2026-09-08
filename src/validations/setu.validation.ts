import { z } from "zod";

export const getPaymentStatusSchema = z.object({
  uniquePaymentRefID: z.string().optional(),
  refId: z.string().optional(),
  refID: z.string().optional(),
  billId: z.string().optional(),
  sessionId: z.string().optional(),
  status: z.string().optional(),
  event: z.string().optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  billAmount: z.union([z.number(), z.string()]).optional(),
  mobileNumber: z.string().optional(),
  billerId: z.string().optional(),
  billerName: z.string().optional(),
  billerCategory: z.string().optional(),
  customerName: z.string().optional(),
  dueDate: z.string().optional(),
  billDate: z.string().optional(),
  billNumber: z.string().optional(),
  billDetails: z.any().optional(),
  userId: z.string().optional(),
  orderId: z.string().optional(),
  rawPayload: z.any().optional(),
}).refine(
  (data) => data.uniquePaymentRefID || data.refId || data.refID || data.billId || data.sessionId,
  {
    message: "At least one reference ID (refId, uniquePaymentRefID, billId, or sessionId) must be provided",
    path: ["refId"],
  }
);

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

