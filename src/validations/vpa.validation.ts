import { z } from "zod";
import { INSTANTPAY_ERRORS } from "../constants/errors";

export const vpaValidation = z.object({
  vpa: z
    .string({ message: INSTANTPAY_ERRORS.VPA_REQUIRED })
    .min(1, INSTANTPAY_ERRORS.VPA_REQUIRED)
    .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/, INSTANTPAY_ERRORS.INVALID_VPA_FORMAT),
  name: z.string().optional(),
});

export type VpaValidationInput = z.infer<typeof vpaValidation>;
