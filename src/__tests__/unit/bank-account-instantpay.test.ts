import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";

describe("InstantPay Penny Drop Bank Account Verification API Integration", () => {
  let verifyBankSpy: any;

  beforeEach(() => {
    verifyBankSpy = vi.spyOn(instantpayClient, "verifyBankAccount").mockImplementation(async (options: any) => {
      const acc = options.accountNumber.trim();
      const ifsc = options.bankIfsc.trim().toUpperCase();

      if (acc.endsWith("000")) {
        return {
          valid: false,
          accountNumber: acc,
          bankIfsc: ifsc,
          status: "INVALID",
          rawResponse: { statuscode: "ERR", status: "Bank Account verification failed" },
        };
      }

      return {
        valid: true,
        accountNumber: acc,
        bankIfsc: ifsc,
        accountHolderName: options.name || "SHAHBAZ STORE",
        txnReferenceId: "tx_pd_123456789",
        accountType: "SAVINGS",
        nameMatchPercent: 98,
        isPennyDrop: true,
        status: "VALID",
        rawResponse: { statuscode: "TXN", status: "Transaction Successful" },
      };
    });
  });

  afterEach(() => {
    verifyBankSpy.mockRestore();
  });

  it("should reject requests with missing account number or IFSC", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should reject invalid IFSC format", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").send({ accountNumber: "91234567890", bankIfsc: "INVALID_IFSC" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should successfully verify valid Bank Account via InstantPay Penny Drop", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").send({ accountNumber: "91234567890", bankIfsc: "HDFC0001234", name: "SHAHBAZ STORE" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.accountNumber).toBe("91234567890");
    expect(res.body.data.bankIfsc).toBe("HDFC0001234");
    expect(res.body.data.accountHolderName).toBe("SHAHBAZ STORE");
    expect(res.body.data.isPennyDrop).toBe(true);
  });

  it("should handle failed Penny Drop response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").send({ accountNumber: "9123456000", bankIfsc: "HDFC0001234" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });
});
