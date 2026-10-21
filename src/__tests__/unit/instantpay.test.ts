import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { instantpayClient } from "../../external";
import { signSellerToken } from "../../utils/jwt";
import { prisma } from "../../config/prisma";

describe("InstantPay PAN Verification API Integration", () => {
  let verifyPanSpy: any;
  const authHeader = `Bearer ${signSellerToken("test-seller-123")}`;

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
    const res = await request(app).post("/api/kyc/verify-pan").set("Authorization", authHeader).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("should reject invalid PAN format (e.g. 12345)", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").set("Authorization", authHeader).send({ pan: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("PAN must be exactly 10 characters");
  });

  it("should successfully verify valid PAN via InstantPay client", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").set("Authorization", authHeader).send({ pan: "ABCDE1234F" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.pan).toBe("ABCDE1234F");
    expect(res.body.data.registeredName).toBe("SUJAL P");
  });

  it("should handle invalid PAN response correctly", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").set("Authorization", authHeader).send({ pan: "ABCDE1234X" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });

  it("should return cached PAN verification without calling InstantPay if already verified", async () => {
    const prismaSpy = vi.spyOn(prisma.panVerificationRecord, "findFirst").mockResolvedValueOnce({
      id: "v_pan_cached_123",
      pan: "ABCDE1234F",
      registeredName: "SUJAL P (CACHED)",
      category: "INDIVIDUAL",
      status: "VALID",
      rawResponse: { data: { panDetails: { userFullName: "SUJAL P (CACHED)" } } },
    } as any);

    const res = await request(app)
      .post("/api/kyc/verify-pan")
      .set("Authorization", authHeader)
      .send({ pan: "ABCDE1234F" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.cached).toBe(true);
    expect(res.body.data.registeredName).toBe("SUJAL P (CACHED)");

    prismaSpy.mockRestore();
  });
});
