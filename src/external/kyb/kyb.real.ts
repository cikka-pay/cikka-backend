/**
 * KYB Real — placeholder for Signzy API integration.
 */
import type { KybService } from "./kyb.interface";

export const kybReal: KybService = {
  async verifyGst() {
    throw new Error("Real KYB GST not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
  async verifyPan() {
    throw new Error("Real KYB PAN not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
  async verifyCin() {
    throw new Error("Real KYB CIN not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
  async sendAadhaarOtp() {
    throw new Error("Real KYB Aadhaar OTP not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
  async verifyAadhaarOtp() {
    throw new Error("Real KYB Aadhaar verify not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
  async verifyBank() {
    throw new Error("Real KYB bank verify not implemented. Set EXTERNAL_SERVICES_MODE=stub.");
  },
};
