import { z } from "zod";
import { AUTH_ERRORS } from "../constants/errors";

export const sellerPhoneSchema = z.object({
  phone: z
    .string({ message: AUTH_ERRORS.PHONE_REQUIRED })
    .min(1, AUTH_ERRORS.PHONE_REQUIRED)
    .regex(/^(\+91)?[0-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
});

export const sellerResendOtpSchema = sellerPhoneSchema.extend({
  retryType: z.enum(["text", "voice"]).optional().default("text"),
  purpose: z.enum(["signup", "signin", "reset"]).optional(),
});
