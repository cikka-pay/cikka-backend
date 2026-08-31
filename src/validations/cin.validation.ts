import { z } from "zod";
import { INSTANTPAY_ERRORS } from "../constants/errors";

export const verifyCinSchema = z.object({
  cin: z
    .string({ message: INSTANTPAY_ERRORS.CIN_REQUIRED })
    .min(1, INSTANTPAY_ERRORS.CIN_REQUIRED)
    .regex(/^[A-Z0-9]{21}$/i, INSTANTPAY_ERRORS.INVALID_CIN_FORMAT),
  externalRef: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
});

export type VerifyCinInput = z.infer<typeof verifyCinSchema>;
