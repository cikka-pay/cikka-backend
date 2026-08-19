/**
 * Application-wide Error & Response Constants
 * Centralizes error messages and codes to maintain production standards.
 */

export const AUTH_ERRORS = {
  UNAUTHORIZED: "Unauthorized access",
  MISSING_AUTH_HEADER: "Missing or malformed Authorization header",
  INVALID_TOKEN: "Invalid or expired token",
  INVALID_SELLER_TOKEN: "Invalid token role: expected seller",
  INVALID_USER_TOKEN: "Invalid token role: expected user",
  PHONE_REQUIRED: "Phone number is required",
  PHONE_AND_OTP_REQUIRED: "Phone and OTP are required",
  NO_PENDING_OTP: "No pending OTP found for this phone number",
  INVALID_OTP: "Invalid or expired OTP",
  USER_NOT_FOUND: "User profile not found",
} as const;

export const SETU_ERRORS = {
  MISSING_REF_ID: "Missing required field: uniquePaymentRefID",
  MISSING_REFUND_ID: "Missing required field: uniquePaymentRefID or refundRefID",
  INVALID_CREDENTIALS: "Invalid Setu authentication credentials",
  UNAUTHORIZED_IP: (ip: string) => `IP ${ip} not authorized for Setu webhook calls`,
} as const;

export const COMMON_ERRORS = {
  NOT_FOUND: "Not found",
  INTERNAL_SERVER_ERROR: "Internal server error",
} as const;
