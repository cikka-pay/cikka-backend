import { z } from "zod";

export const fetchBillSchema = z.object({
  billerId: z.string().min(1, "billerId is required"),
  customerParams: z.record(z.string(), z.string()).refine((obj) => Object.keys(obj).length > 0, {
    message: "At least one customer parameter is required",
  }),
});

export const initiateBbpsPaymentSchema = z.object({
  billerId: z.string().min(1, "billerId is required"),
  billerName: z.string().min(1, "billerName is required"),
  category: z.string().min(1, "category is required"),
  amount: z.number().positive("Amount must be a positive number"),
  customerParams: z.record(z.string(), z.string()),
  setuBillId: z.string().optional(),
  refID: z.string().optional(),
});

export const getBillerSchema = z.object({
  category: z.string().optional(),
});
