import { z } from "zod";
import { INSTANTPAY_ERRORS } from "../constants/errors";

export const aadhaarValidation = z.object({
  aadhaarNumber: z
    .string({ message: INSTANTPAY_ERRORS.AADHAAR_REQUIRED })
    .min(1, INSTANTPAY_ERRORS.AADHAAR_REQUIRED)
    .refine(
      (val) => /^[2-9]{1}[0-9]{11}$/.test(val.trim()) || /^[a-zA-Z0-9+/=]{44}$/.test(val.trim()),
      { message: INSTANTPAY_ERRORS.INVALID_AADHAAR_FORMAT }
    ),
  name: z.string().optional(),
});

export type AadhaarValidationInput = z.infer<typeof aadhaarValidation>;
