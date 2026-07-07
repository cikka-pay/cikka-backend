/**
 * KYB Stub — used when EXTERNAL_SERVICES_MODE=stub (default in dev/test).
 *
 * All verification calls return success for any input.
 * Aadhaar OTP bypass code: "111111" (handled in auth.service, not here).
 */
import type {
  KybService,
  GstVerifyResult,
  PanVerifyResult,
  CinVerifyResult,
  AadhaarOtpResult,
  AadhaarVerifyResult,
  BankVerifyResult,
} from "./kyb.interface";

export const kybStub: KybService = {
  async verifyGst(gstin: string): Promise<GstVerifyResult> {
    console.log(`[KYB STUB] GST verify: ${gstin} → valid`);
    return {
      valid: true,
      businessName: "Demo Business Pvt Ltd",
      state: "Maharashtra",
      type: "Regular",
    };
  },

  async verifyPan(pan: string): Promise<PanVerifyResult> {
    console.log(`[KYB STUB] PAN verify: ${pan} → valid`);
    return { valid: true, status: "Active", name: "Demo Business Pvt Ltd" };
  },

  async verifyCin(cin: string): Promise<CinVerifyResult> {
    console.log(`[KYB STUB] CIN verify: ${cin} → valid`);
    return { valid: true, companyName: "Demo Business Pvt Ltd", status: "Active" };
  },

  async sendAadhaarOtp(aadhaar: string, mobile: string): Promise<AadhaarOtpResult> {
    console.log(`[KYB STUB] Aadhaar OTP → sent to ${mobile}  (bypass: 111111)`);
    return { otpSent: true, referenceId: "STUB-REF-001" };
  },

  async verifyAadhaarOtp(referenceId: string, otp: string): Promise<AadhaarVerifyResult> {
    // Bypass: OTP 111111 always passes
    const valid = otp === "111111" || otp.length === 6;
    console.log(`[KYB STUB] Aadhaar OTP verify: ${otp} → ${valid ? "valid" : "invalid"}`);
    return { valid, name: valid ? "Demo Signatory" : undefined };
  },

  async verifyBank(ifsc: string, accountNumber: string): Promise<BankVerifyResult> {
    console.log(`[KYB STUB] Bank verify IFSC=${ifsc} → valid`);
    return { valid: true, bankName: "Demo Bank", holderName: "Demo Business Pvt Ltd" };
  },
};
