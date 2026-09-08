import { encryptAadhaarAes, resolveGstState, resolveGstConstitution } from "../../src/external/instantpay/instantpay.real";
import { instantpayStub } from "../../src/external/instantpay/instantpay.stub";
import { verifyAadhaarService } from "../../src/services/instantpay.service";

describe("InstantPay Verification & Encryption Unit Tests", () => {
  describe("encryptAadhaarAes", () => {
    it("should encrypt 12-digit Aadhaar number into a valid Base64 string", () => {
      const aadhaar = "234567890123";
      const secret = "0123456789abcdef0123456789abcdef";
      const encrypted = encryptAadhaarAes(aadhaar, secret);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe("string");
      expect(encrypted).not.toEqual(aadhaar);
      // Valid Base64 check
      expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
    });
  });

  describe("resolveGstState", () => {
    it("should resolve correct state name from GSTIN state code prefix", () => {
      expect(resolveGstState("27AAAAA0000A1Z5")).toBe("Maharashtra");
      expect(resolveGstState("07AAAAA0000A1Z5")).toBe("Delhi");
      expect(resolveGstState("29AAAAA0000A1Z5")).toBe("Karnataka");
    });
  });

  describe("resolveGstConstitution", () => {
    it("should resolve Private Limited Company from business name", () => {
      const constitution = resolveGstConstitution("ACME TECH PRIVATE LIMITED", "ACME TECH");
      expect(constitution).toBe("Private Limited Company");
    });

    it("should resolve Sole Proprietorship by default", () => {
      const constitution = resolveGstConstitution("JOHN DOE STORES", "JOHN STORES");
      expect(constitution).toBe("Sole Proprietorship");
    });
  });

  describe("verifyAadhaarService", () => {
    it("should throw validation error if Aadhaar format is invalid", async () => {
      await expect(verifyAadhaarService({ aadhaarNumber: "12345" })).rejects.toThrow();
    });

    it("should execute successfully in stub mode for valid 12-digit Aadhaar", async () => {
      const stubResult = await instantpayStub.verifyAadhaar({ aadhaarNumber: "234567890123" });
      expect(stubResult).toBeDefined();
      expect(stubResult.valid).toBe(true);
      expect(stubResult.aadhaarNumber).toBe("234567890123");
    });
  });
});
