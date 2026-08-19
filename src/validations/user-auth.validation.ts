import { z } from "zod";

export const phoneSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
});

export const otpSchema = phoneSchema.extend({
  otp: z.string().length(6, "OTP must be 6 digits"),
});
