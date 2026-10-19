import type { KybService } from "./kyb.interface";
import { instantpayReal } from "../instantpay/instantpay.real";
import { kybStub } from "./kyb.stub";

export const kybReal: KybService = {
  async verifyGst(gstNumber: string) {
    try {
      const res = await instantpayReal.verifyGstin(gstNumber);
      return {
        valid: Boolean(res.valid),
        businessName: res.legalName || res.tradeName || "",
        state: res.state || "",
        type: res.businessType || "Regular",
      };
    } catch (err: any) {
      console.error(`[KYB Real] verifyGst failed: ${err.message}`);
      return {
        valid: false,
        businessName: "",
        state: "",
        type: "",
      };
    }
  },

  async verifyPan(panNumber: string) {
    try {
      const res = await instantpayReal.verifyPan(panNumber);
      return {
        valid: Boolean(res.valid),
        status: res.status || (res.valid ? "Active" : "Invalid"),
        name: res.registeredName || "",
      };
    } catch (err: any) {
      console.error(`[KYB Real] verifyPan failed: ${err.message}`);
      return {
        valid: false,
        status: "Invalid",
        name: "",
      };
    }
  },

  async verifyCin(cinNumber: string) {
    try {
      const res = await instantpayReal.verifyCin(cinNumber);
      return {
        valid: Boolean(res.valid),
        companyName: res.companyName || "",
        status: res.companyStatus || (res.valid ? "Active" : "Invalid"),
      };
    } catch (err: any) {
      console.error(`[KYB Real] verifyCin failed: ${err.message}`);
      return {
        valid: false,
        companyName: "",
        status: "Invalid",
      };
    }
  },

  async sendAadhaarOtp(aadhaar: string, mobile: string) {
    return kybStub.sendAadhaarOtp(aadhaar, mobile);
  },

  async verifyAadhaarOtp(referenceId: string, otp: string) {
    return kybStub.verifyAadhaarOtp(referenceId, otp);
  },

  async verifyBank(ifsc: string, accountNumber: string) {
    try {
      const res = await instantpayReal.verifyBankAccount({
        accountNumber,
        bankIfsc: ifsc,
      });
      return {
        valid: Boolean(res.valid),
        bankName: ifsc ? `${ifsc.substring(0, 4)} Bank` : "Bank",
        holderName: res.accountHolderName || undefined,
      };
    } catch (err: any) {
      console.error(`[KYB Real] verifyBank failed: ${err.message}`);
      return {
        valid: false,
        bankName: "",
        holderName: undefined,
      };
    }
  },
};
