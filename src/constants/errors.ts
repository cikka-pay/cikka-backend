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

export const BBPS_ERRORS = {
  BILLER_NOT_FOUND: "Specified BBPS biller was not found",
  BILLER_ID_REQUIRED: "Biller ID is required",
  CUSTOMER_PARAMS_REQUIRED: "Customer account parameters are required",
  BILL_NOT_FOUND: "No active bill found for the provided customer details",
  BILL_FETCH_FAILED: "Unable to fetch bill from BBPS gateway",
  INVALID_CUSTOMER_PARAMS: "Invalid or missing biller customer parameters",
  PAYMENT_FAILED: "Bill payment processing failed at BBPS gateway",
  PAYMENT_INITIATION_FAILED: "Failed to initiate BBPS payment order",
  INVALID_PAYMENT_AMOUNT: "Payment amount must be greater than zero",
  TRANSACTION_NOT_FOUND: "BBPS transaction refID not found",
  REFUND_FAILED: "BBPS refund processing failed",
} as const;

export const INSTANTPAY_ERRORS = {
  PAN_REQUIRED: "PAN number is required",
  INVALID_PAN_FORMAT: "Invalid PAN format. Example: ABCDE1234F",
  VERIFICATION_FAILED: "InstantPay PAN verification failed",
  CREDENTIALS_MISSING: "InstantPay API credentials are not configured",
  API_ERROR: (msg: string) => `InstantPay API error: ${msg}`,
} as const;

export const COMMON_ERRORS = {
  NOT_FOUND: "Not found",
  INTERNAL_SERVER_ERROR: "Internal server error",
} as const;

