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

export const BILLPAY_ERRORS = {
  PHONE_NOT_VERIFIED: "Verify your mobile number before paying bills",
  INVALID_PHONE: "Your profile does not have a valid 10-digit mobile number",
  SETU_UNAVAILABLE: "Bill payment service is unavailable right now. Please try again.",
} as const;

export const INSTANTPAY_ERRORS = {
  PAN_REQUIRED: "PAN number is required",
  INVALID_PAN_FORMAT: "Invalid PAN format. Example: AAAAA1111A",
  VERIFICATION_FAILED: "InstantPay PAN verification failed",
  CREDENTIALS_MISSING: "InstantPay API credentials are not configured",
  GSTIN_REQUIRED: "GSTIN number is required",
  INVALID_GSTIN_FORMAT: "Invalid GSTIN format. Example: 11AAAAA1111A1Z1",
  VERIFICATION_FAILED_GSTIN: "InstantPay GSTIN verification failed",
  CIN_REQUIRED: "CIN number is required",
  INVALID_CIN_FORMAT: "Invalid MCA CIN format. Example: U74999MH2019PTC123456",
  VERIFICATION_FAILED_CIN: "InstantPay CIN verification failed",
  AADHAAR_REQUIRED: "Aadhaar number is required",
  INVALID_AADHAAR_FORMAT: "Invalid Aadhaar format. Must be a 12-digit Indian Aadhaar number",
  VERIFICATION_FAILED_AADHAAR: "InstantPay Aadhaar verification failed",
  VPA_REQUIRED: "UPI VPA ID is required",
  INVALID_VPA_FORMAT: "Invalid UPI VPA format. Example: username@bank",
  VERIFICATION_FAILED_VPA: "InstantPay VPA verification failed",
  ACCOUNT_NUMBER_REQUIRED: "Bank account number is required",
  INVALID_ACCOUNT_FORMAT: "Invalid bank account number format. Must be between 9 and 18 digits",
  IFSC_REQUIRED: "Bank IFSC code is required",
  INVALID_IFSC_FORMAT: "Invalid Bank IFSC format. Example: HDFC0001234",
  VERIFICATION_FAILED_BANK: "InstantPay Penny Drop bank verification failed",
  PENNY_DROP_RATE_LIMIT_EXCEEDED: "we have scouted limited brands for today please try again tomorrow at earliest",
  API_ERROR: (msg: string) => `InstantPay API error: ${msg}`,
} as const;

export const COMMON_ERRORS = {
  NOT_FOUND: "Not found",
  INTERNAL_SERVER_ERROR: "Internal server error",
} as const;

export const UPLOAD_ERRORS = {
  FILE_REQUIRED: "No file provided",
  FILE_TOO_LARGE: (maxMB: number) => `File exceeds maximum size of ${maxMB}MB`,
  INVALID_MIME_TYPE: (allowed: string[]) =>
    `Invalid file type. Allowed: ${allowed.join(", ")}`,
  UPLOAD_FAILED: "File upload failed",
  DELETE_FAILED: "File deletion failed",
  FILE_NOT_FOUND: "File not found in storage",
  STORAGE_NOT_CONFIGURED: "Storage service is not properly configured",
} as const;

