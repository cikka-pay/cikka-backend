import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";

describe("InstantPay GSTIN Verification API Integration", () => {
  let verifyGstinSpy: any;

  beforeEach(() => {
    verifyGstinSpy = vi.spyOn(instantpayClient, "verifyGstin").mockImplementation(async (gstOrOptions: any) => {
      const gstin = typeof gstOrOptions === "string" ? gstOrOptions : gstOrOptions.gstNumber;
      const formattedGstin = gstin.toUpperCase();

      if (formattedGstin.endsWith("X")) {
        return {
          valid: false,
          gstin: formattedGstin,
          status: "Canceled",
          rawResponse: { statuscode: "ERR", status: "GSTIN Canceled" },
        };
      }

      return {
        valid: true,
        gstin: formattedGstin,
        legalName: "CIKKA DIGITAL PRIVATE LIMITED",
        tradeName: "Cikka Pay",
        status: "Active",
        businessType: "Private Limited",
        state: "Gujarat",
        address: {
          bnm: "Cikka Heights",
          dst: "Ahmedabad",
          pncd: "380054",
        },
        rawResponse: { statuscode: "TXN", status: "Transaction Successful" },
      };
    });
  });

  afterEach(() => {
    verifyGstinSpy.mockRestore();
  });

  it("should reject requests with missing GSTIN number", async () => {
    const res = await request(app).post("/api/kyc/verify-gstin").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should reject invalid GSTIN format (e.g. 12345)", async () => {
    const res = await request(app).post("/api/kyc/verify-gstin").send({ gstNumber: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should successfully verify valid GSTIN via InstantPay client", async () => {
    const res = await request(app).post("/api/kyc/verify-gstin").send({ gstNumber: "24DACP2435DZY" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.gstin).toBe("24DACP2435DZY");
    expect(res.body.data.legalName).toBe("CIKKA DIGITAL PRIVATE LIMITED");
    expect(res.body.data.status).toBe("Active");
  });

  it("should handle canceled or invalid GSTIN response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-gstin").send({ gstNumber: "24DACP2435DZX" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("Canceled");
  });
});
