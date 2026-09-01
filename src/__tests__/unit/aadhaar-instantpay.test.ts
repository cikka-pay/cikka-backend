import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";

describe("InstantPay Aadhaar Demographic Verification API Integration", () => {
  let verifyAadhaarSpy: any;

  beforeEach(() => {
    verifyAadhaarSpy = vi.spyOn(instantpayClient, "verifyAadhaar").mockImplementation(async (aadhaarOrOptions: any) => {
      const options = typeof aadhaarOrOptions === "string" ? { aadhaarNumber: aadhaarOrOptions } : aadhaarOrOptions;
      const aadhaarNumber = options.aadhaarNumber.trim();

      if (aadhaarNumber.endsWith("0")) {
        return {
          valid: false,
          aadhaarNumber,
          status: "INVALID",
          rawResponse: { statuscode: "ERR", status: "Aadhaar Invalid or Inactive" },
        };
      }

      return {
        valid: true,
        aadhaarNumber,
        aadhaarHolderName: options.name || "Sample Aadhaar Holder",
        status: "VALID",
        rawResponse: { statuscode: "TXN", status: "Transaction Successful" },
      };
    });
  });

  afterEach(() => {
    verifyAadhaarSpy.mockRestore();
  });

  it("should reject requests with missing Aadhaar number", async () => {
    const res = await request(app).post("/api/kyc/verify-aadhaar").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should reject invalid Aadhaar length/format", async () => {
    const res = await request(app).post("/api/kyc/verify-aadhaar").send({ aadhaarNumber: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should successfully verify valid 12-digit Aadhaar number via InstantPay client", async () => {
    const res = await request(app).post("/api/kyc/verify-aadhaar").send({ aadhaarNumber: "999999990019", name: "Sample Name" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.aadhaarNumber).toBe("999999990019");
    expect(res.body.data.aadhaarHolderName).toBe("Sample Name");
  });

  it("should handle invalid Aadhaar number response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-aadhaar").send({ aadhaarNumber: "999999990010" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });
});
