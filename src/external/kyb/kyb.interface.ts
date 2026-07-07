// KYB (Know Your Business) Service Interface
// Powered by Signzy in production.

export interface GstVerifyResult {
  valid: boolean;
  businessName: string;
  state: string;
  type: string; // Regular | Composition | etc.
}

export interface PanVerifyResult {
  valid: boolean;
  status: string; // Active | Inactive
  name: string;
}

export interface CinVerifyResult {
  valid: boolean;
  companyName: string;
  status: string; // Active | Struck Off | etc.
}

export interface AadhaarOtpResult {
  otpSent: boolean;
  referenceId?: string; // Used in verify step
}

export interface AadhaarVerifyResult {
  valid: boolean;
  name?: string;
}

export interface BankVerifyResult {
  valid: boolean;
  bankName: string;
  holderName?: string; // From penny drop
}

export interface KybService {
  verifyGst(gstin: string): Promise<GstVerifyResult>;
  verifyPan(pan: string): Promise<PanVerifyResult>;
  verifyCin(cin: string): Promise<CinVerifyResult>;
  sendAadhaarOtp(aadhaar: string, mobile: string): Promise<AadhaarOtpResult>;
  verifyAadhaarOtp(referenceId: string, otp: string): Promise<AadhaarVerifyResult>;
  verifyBank(ifsc: string, accountNumber: string): Promise<BankVerifyResult>;
}
