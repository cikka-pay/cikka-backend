import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app";

describe("InstantPay PAN Verification API Integration", () => {
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

  it("should successfully verify valid PAN via InstantPay stub client", async () => {
    const res = await request(app).post("/api/kyc/verify-pan").send({ pan: "ABCDE1234F" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.pan).toBe("ABCDE1234F");
    expect(res.body.data.registeredName).toBe("SUJAL P");
  });

  it("should handle invalid PAN response correctly", async () => {
    // Stub returns invalid for PAN ending in X
    const res = await request(app).post("/api/kyc/verify-pan").send({ pan: "ABCDE1234X" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.status).toBe("INVALID");
  });
});
