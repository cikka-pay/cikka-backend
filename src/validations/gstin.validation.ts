import { z } from "zod";
import { INSTANTPAY_ERRORS } from "../constants/errors";

export const verifyGstinSchema = z.object({
  gstNumber: z
    .string({ message: INSTANTPAY_ERRORS.GSTIN_REQUIRED })
    .min(1, INSTANTPAY_ERRORS.GSTIN_REQUIRED)
    .regex(/^[0-9]{2}[A-Z0-9]{10,13}$/i, INSTANTPAY_ERRORS.INVALID_GSTIN_FORMAT),
  externalRef: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
});

export type VerifyGstinInput = z.infer<typeof verifyGstinSchema>;
