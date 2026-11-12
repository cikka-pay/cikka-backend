import { z } from "zod";

// POST /api/bbps/session — every field optional; an empty body opens Setu's biller picker.
export const createBillpaySessionSchema = z
  .object({
    categoryName: z.string().trim().min(1).max(100).optional(),
    billerId: z.string().trim().min(1).max(100).optional(),
    redirectTo: z.enum(["transactions", "disputes"]).optional(),
  })
  .default({});

export type CreateBillpaySessionBody = z.infer<typeof createBillpaySessionSchema>;
