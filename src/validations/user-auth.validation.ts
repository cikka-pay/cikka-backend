import { z } from "zod";
import { AUTH_ERRORS } from "../constants/errors";

export const phoneSchema = z.object({
  phone: z
    .string({ message: AUTH_ERRORS.PHONE_REQUIRED })
    .min(1, AUTH_ERRORS.PHONE_REQUIRED)
    .regex(/^(\+91)?[0-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
});

export const otpSchema = z.object({
  phone: z
    .string({ message: AUTH_ERRORS.PHONE_AND_OTP_REQUIRED })
    .min(1, AUTH_ERRORS.PHONE_AND_OTP_REQUIRED)
    .regex(/^(\+91)?[0-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  otp: z
    .string({ message: AUTH_ERRORS.PHONE_AND_OTP_REQUIRED })
    .min(1, AUTH_ERRORS.PHONE_AND_OTP_REQUIRED),
});

export const resendOtpSchema = z.object({
  phone: z
    .string({ message: AUTH_ERRORS.PHONE_REQUIRED })
    .min(1, AUTH_ERRORS.PHONE_REQUIRED)
    .regex(/^(\+91)?[0-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  retryType: z.enum(["text", "voice"]).optional().default("text"),
});
