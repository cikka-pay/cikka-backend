import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";

describe("InstantPay UPI VPA Verification API Integration", () => {
  let verifyVpaSpy: any;

  beforeEach(() => {
    verifyVpaSpy = vi.spyOn(instantpayClient, "verifyVpa").mockImplementation(async (vpaOrOptions: any) => {
      const options = typeof vpaOrOptions === "string" ? { vpa: vpaOrOptions } : vpaOrOptions;
      const vpa = options.vpa.trim();

      if (vpa.includes("invalid")) {
        return {
          valid: false,
          vpa,
          status: "INVALID",
          rawResponse: { statuscode: "ERR", status: "VPA handle not found or invalid" },
        };
      }

      return {
        valid: true,
        vpa,
        accountHolderName: options.name || "Instantpay India Ltd",
        ifsc: options.bankIfsc || "ICIC0000104",
        accountType: "SAVINGS",
        nameMatchPercent: 96,
        status: "VALID",
        rawResponse: { statuscode: "TXN", status: "Transaction Successful" },
      };
    });
  });

  afterEach(() => {
    verifyVpaSpy.mockRestore();
  });

  it("should reject requests with missing VPA handle", async () => {
    const res = await request(app).post("/api/kyc/verify-vpa").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should reject invalid VPA format", async () => {
    const res = await request(app).post("/api/kyc/verify-vpa").send({ vpa: "invalid_vpa_no_at_sign" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should successfully verify valid UPI VPA handle via InstantPay client", async () => {
    const res = await request(app).post("/api/kyc/verify-vpa").send({ vpa: "ipay.109564@icici", name: "Instantpay India Ltd" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.vpa).toBe("ipay.109564@icici");
    expect(res.body.data.accountHolderName).toBe("Instantpay India Ltd");
  });

  it("should handle invalid VPA handle response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-vpa").send({ vpa: "invalid.vpa@upi" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });
});
