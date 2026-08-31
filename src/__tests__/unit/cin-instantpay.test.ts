import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";

describe("InstantPay CIN Verification API Integration", () => {
  let verifyCinSpy: any;

  beforeEach(() => {
    verifyCinSpy = vi.spyOn(instantpayClient, "verifyCin").mockImplementation(async (cinOrOptions: any) => {
      const cin = typeof cinOrOptions === "string" ? cinOrOptions : cinOrOptions.cin;
      const formattedCin = cin.toUpperCase();

      if (formattedCin.endsWith("X")) {
        return {
          valid: false,
          cin: formattedCin,
          companyStatus: "Strike Off",
          rawResponse: { statuscode: "ERR", status: "CIN Struck Off" },
        };
      }

      return {
        valid: true,
        cin: formattedCin,
        companyName: "AURA VOGUE PRIVATE LIMITED",
        companyStatus: "Active",
        companyType: "Private Limited",
        state: "Maharashtra",
        registrationDate: "2019-06-15",
        rawResponse: { statuscode: "TXN", status: "Transaction Successful" },
      };
    });
  });

  afterEach(() => {
    verifyCinSpy.mockRestore();
  });

  it("should reject requests with missing CIN number", async () => {
    const res = await request(app).post("/api/kyc/verify-cin").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should reject invalid CIN length/format", async () => {
    const res = await request(app).post("/api/kyc/verify-cin").send({ cin: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should successfully verify valid CIN via InstantPay client", async () => {
    const res = await request(app).post("/api/kyc/verify-cin").send({ cin: "U74999MH2019PTC123456" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.cin).toBe("U74999MH2019PTC123456");
    expect(res.body.data.companyName).toBe("AURA VOGUE PRIVATE LIMITED");
    expect(res.body.data.companyStatus).toBe("Active");
  });

  it("should handle struck off or invalid CIN response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-cin").send({ cin: "U74999MH2019PTC12345X" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.companyStatus).toBe("Strike Off");
  });
});
