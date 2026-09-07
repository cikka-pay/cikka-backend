import type { KybService } from "./kyb.interface";
import { kybStub } from "./kyb.stub";

export const kybReal: KybService = {
  async verifyGst(gstNumber: string) {
    return kybStub.verifyGst(gstNumber);
  },
  async verifyPan(panNumber: string) {
    return kybStub.verifyPan(panNumber);
  },
  async verifyCin(cinNumber: string) {
    return kybStub.verifyCin(cinNumber);
  },
  async sendAadhaarOtp(aadhaar: string, mobile: string) {
    return kybStub.sendAadhaarOtp(aadhaar, mobile);
  },
  async verifyAadhaarOtp(referenceId: string, otp: string) {
    return kybStub.verifyAadhaarOtp(referenceId, otp);
  },
  async verifyBank(ifsc: string, accountNumber: string) {
    return kybStub.verifyBank(ifsc, accountNumber);
  },
};
