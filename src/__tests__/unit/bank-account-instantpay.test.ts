import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";
import { signSellerToken } from "../../utils/jwt";
import { resetPennyDropLimiter } from "../../services/pennydrop-limiter.service";

describe("InstantPay Penny Drop Bank Account Verification API Integration", () => {
  let verifyBankSpy: any;
  const authHeader = `Bearer ${signSellerToken("test-seller-123")}`;

  beforeEach(() => {
    resetPennyDropLimiter();
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
    const res = await request(app).post("/api/kyc/verify-bank-account").set("Authorization", authHeader).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Bank account number is required|Validation failed/);
  });

  it("should reject invalid IFSC format", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").set("Authorization", authHeader).send({ accountNumber: "91234567890", bankIfsc: "INVALID_IFSC" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid Bank IFSC format|Validation failed/);
  });

  it("should successfully verify valid Bank Account via InstantPay Penny Drop", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").set("Authorization", authHeader).send({ accountNumber: "91234567890", bankIfsc: "HDFC0001234", name: "SHAHBAZ STORE" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.accountNumber).toBe("91234567890");
    expect(res.body.data.bankIfsc).toBe("HDFC0001234");
    expect(res.body.data.accountHolderName).toBe("SHAHBAZ STORE");
    expect(res.body.data.isPennyDrop).toBe(true);
  });

  it("should handle failed Penny Drop response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-bank-account").set("Authorization", authHeader).send({ accountNumber: "9123456000", bankIfsc: "HDFC0001234" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });

  it("should allow exactly 12 penny drop calls within 24 hours and block the 13th call with rate limit message", async () => {
    // 12 calls should succeed
    for (let i = 1; i <= 12; i++) {
      const res = await request(app)
        .post("/api/kyc/verify-bank-account")
        .set("Authorization", authHeader)
        .send({ accountNumber: "91234567890", bankIfsc: "HDFC0001234", name: `CALL ${i}` });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }

    // 13th call should be blocked with 429 and the founder's exact message
    const resBlocked = await request(app)
      .post("/api/kyc/verify-bank-account")
      .set("Authorization", authHeader)
      .send({ accountNumber: "91234567890", bankIfsc: "HDFC0001234", name: "CALL 13" });

    expect(resBlocked.status).toBe(429);
    expect(resBlocked.body.success).toBe(false);
    expect(resBlocked.body.message).toBe("we have scouted limited brands for today please try again tomorrow at earliest");
    expect(resBlocked.body.error).toBe("we have scouted limited brands for today please try again tomorrow at earliest");
  });

  it("should allow a different user to trigger calls even if another user has exhausted their 12 calls", async () => {
    // User 1 exhausts 12 calls
    for (let i = 1; i <= 12; i++) {
      await request(app)
        .post("/api/kyc/verify-bank-account")
        .set("Authorization", authHeader)
        .send({ accountNumber: "91234567890", bankIfsc: "HDFC0001234" });
    }

    // User 2 with a different seller token should succeed
    const user2Auth = `Bearer ${signSellerToken("different-seller-456")}`;
    const resUser2 = await request(app)
      .post("/api/kyc/verify-bank-account")
      .set("Authorization", user2Auth)
      .send({ accountNumber: "91234567890", bankIfsc: "HDFC0001234" });

    expect(resUser2.status).toBe(200);
    expect(resUser2.body.success).toBe(true);
  });
});
