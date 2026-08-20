import { z } from "zod";

export const phoneSchema = z.object({
  phone: z.string().regex(/^(\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
});

export const otpSchema = phoneSchema.extend({
  otp: z.string().min(4, "OTP must be at least 4 digits").max(6, "OTP must be at most 6 digits"),
});
