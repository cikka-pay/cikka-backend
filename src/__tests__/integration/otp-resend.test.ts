import { describe, it, expect } from "vitest";
import supertest from "supertest";
import app from "../../app";

describe("Resend OTP Integration Tests", () => {
  describe("Mobile App User Resend OTP (/api/user-auth/resend-otp)", () => {
    it("should send and resend OTP for mobile app user", async () => {
      const phone = "9111122222";

      // 1. Initial Send OTP
      const sendRes = await supertest(app)
        .post("/api/user-auth/send-otp")
        .send({ phone });

      expect(sendRes.status).toBe(200);

      // 2. Resend OTP (SMS)
      const resendRes = await supertest(app)
        .post("/api/user-auth/resend-otp")
        .send({ phone, retryType: "text" });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body.message).toBeDefined();

      // 3. Verify with bypass OTP or devOtp
      const devOtp = resendRes.body.devOtp || "111111";
      const verifyRes = await supertest(app)
        .post("/api/user-auth/verify-otp")
        .send({ phone, otp: devOtp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.token).toBeDefined();
    });

    it("should reject resend OTP request with missing phone number", async () => {
      const res = await supertest(app)
        .post("/api/user-auth/resend-otp")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.details).toBeDefined();
    });
  });

  describe("Seller Resend OTP (/api/auth/resend-otp)", () => {
    it("should resend seller signup OTP", async () => {
      const phone = "9888877777";

      // Send signup phone OTP
      await supertest(app).post("/api/auth/signup/send-phone-otp").send({ phone });

      // Resend OTP
      const resendRes = await supertest(app)
        .post("/api/auth/resend-otp")
        .send({ phone, purpose: "signup" });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body.message).toBeDefined();
    });
  });
});
