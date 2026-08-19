import { z } from "zod";
import { AUTH_ERRORS } from "../constants/errors";

export const phoneSchema = z.object({
  phone: z
    .string({
      required_error: AUTH_ERRORS.PHONE_REQUIRED,
      invalid_type_error: AUTH_ERRORS.PHONE_REQUIRED,
    })
    .min(1, AUTH_ERRORS.PHONE_REQUIRED)
    .regex(/^(\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
});

export const otpSchema = z.object({
  phone: z
    .string({
      required_error: AUTH_ERRORS.PHONE_AND_OTP_REQUIRED,
      invalid_type_error: AUTH_ERRORS.PHONE_AND_OTP_REQUIRED,
    })
    .min(1, AUTH_ERRORS.PHONE_AND_OTP_REQUIRED)
    .regex(/^(\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  otp: z
    .string({
      required_error: AUTH_ERRORS.PHONE_AND_OTP_REQUIRED,
      invalid_type_error: AUTH_ERRORS.PHONE_AND_OTP_REQUIRED,
    })
    .min(1, AUTH_ERRORS.PHONE_AND_OTP_REQUIRED),
});

