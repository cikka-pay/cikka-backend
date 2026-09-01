import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";

describe("InstantPay PAN Verification API Integration", () => {
  let verifyPanSpy: any;

  beforeEach(() => {
    verifyPanSpy = vi.spyOn(instantpayClient, "verifyPan").mockImplementation(async (panOrOptions: any) => {
      const pan = typeof panOrOptions === "string" ? panOrOptions : panOrOptions.pan;
      const formattedPan = pan.toUpperCase();

      if (formattedPan.endsWith("X")) {
        return {
          valid: false,
          pan: formattedPan,
          status: "INVALID",
          rawResponse: { statuscode: "ERR", status: "FAILED" },
        };
      }

      return {
        valid: true,
        pan: formattedPan,
        registeredName: "SUJAL P",
        category: "INDIVIDUAL",
        status: "VALID",
        rawResponse: { statuscode: "TXN", status: "SUCCESS" },
      };
    });
  });

  afterEach(() => {
    verifyPanSpy.mockRestore();
  });

  it("should reject requests with missing PAN number", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should reject invalid PAN format (e.g. 12345)", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").send({ pan: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("should successfully verify valid PAN via InstantPay client", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").send({ pan: "ABCDE1234F" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.pan).toBe("ABCDE1234F");
    expect(res.body.data.registeredName).toBe("SUJAL P");
  });

  it("should handle invalid PAN response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").send({ pan: "ABCDE1234X" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });
});
