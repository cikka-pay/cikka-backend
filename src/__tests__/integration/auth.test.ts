import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData } from "../helpers";

describe("Auth Integration Tests", () => {
  const phone = "+919999999999";
  const email = "testsignup@test.com";

  beforeEach(async () => {
    await cleanTestData([phone]);
  });

  describe("Signup Flow", () => {
    it("Step 1: Should send phone OTP", async () => {
      const res = await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("OTP sent");
      
      const seller = await prisma.seller.findUnique({ where: { phone } });
      expect(seller).toBeDefined();
      expect(seller?.phoneOtpCode).toBeDefined();
    });

    it("Step 2: Should verify phone OTP", async () => {
      // Seed first
      await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      
      const res = await request(app).post("/api/auth/signup/verify-phone-otp").send({ phone, otp: "111111" });
      expect(res.status).toBe(200);
      expect(res.body.signupToken).toBeDefined(); // Used for next steps
    });

    it("Step 3: Should send email OTP", async () => {
      await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      const verifyRes = await request(app).post("/api/auth/signup/verify-phone-otp").send({ phone, otp: "111111" });
      const { signupToken } = verifyRes.body;

      const res = await request(app)
        .post("/api/auth/signup/send-email-otp")
        .set("Authorization", `Bearer ${signupToken}`)
        .send({ email });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("OTP sent to email");
    });

    it("Step 4: Should verify email OTP", async () => {
      await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      const verifyRes = await request(app).post("/api/auth/signup/verify-phone-otp").send({ phone, otp: "111111" });
      const { signupToken } = verifyRes.body;
      await request(app).post("/api/auth/signup/send-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email });

      const res = await request(app)
        .post("/api/auth/signup/verify-email-otp")
        .set("Authorization", `Bearer ${signupToken}`)
        .send({ email, otp: "111111" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Email verified");
    });

    it("Step 5: Should set password and return JWT", async () => {
      await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      const verifyRes = await request(app).post("/api/auth/signup/verify-phone-otp").send({ phone, otp: "111111" });
      const { signupToken } = verifyRes.body;
      await request(app).post("/api/auth/signup/send-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email });
      await request(app).post("/api/auth/signup/verify-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email, otp: "111111" });

      const res = await request(app)
        .post("/api/auth/signup/set-password")
        .set("Authorization", `Bearer ${signupToken}`)
        .send({ password: "Secure@123" });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.seller).toBeDefined();
      
      const seller = await prisma.seller.findUnique({ where: { phone } });
      expect(seller?.passwordHash).toBeDefined();
    });
  });

  describe("Signin Flow (Phone OTP)", () => {
    beforeEach(async () => {
      // Create a verified seller for signin
      await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      const verifyRes = await request(app).post("/api/auth/signup/verify-phone-otp").send({ phone, otp: "111111" });
      const { signupToken } = verifyRes.body;
      await request(app).post("/api/auth/signup/send-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email });
      await request(app).post("/api/auth/signup/verify-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email, otp: "111111" });
      await request(app).post("/api/auth/signup/set-password").set("Authorization", `Bearer ${signupToken}`).send({ password: "Secure@123" });
    });

    it("Should send signin OTP", async () => {
      const res = await request(app).post("/api/auth/signin/send-otp").send({ phone });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("OTP sent");
    });

    it("Should verify signin OTP and return JWT", async () => {
      await request(app).post("/api/auth/signin/send-otp").send({ phone });
      
      const res = await request(app).post("/api/auth/signin/verify-otp").send({ phone, otp: "111111" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.seller).toBeDefined();
    });

    it("Should fail signin for unregistered phone", async () => {
      const res = await request(app).post("/api/auth/signin/send-otp").send({ phone: "+910000000000" });
      expect(res.status).toBe(404);
    });
  });

  describe("Forgot Password Flow", () => {
    beforeEach(async () => {
      await request(app).post("/api/auth/signup/send-phone-otp").send({ phone });
      const verifyRes = await request(app).post("/api/auth/signup/verify-phone-otp").send({ phone, otp: "111111" });
      const { signupToken } = verifyRes.body;
      await request(app).post("/api/auth/signup/send-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email });
      await request(app).post("/api/auth/signup/verify-email-otp").set("Authorization", `Bearer ${signupToken}`).send({ email, otp: "111111" });
      await request(app).post("/api/auth/signup/set-password").set("Authorization", `Bearer ${signupToken}`).send({ password: "Secure@123" });
    });

    it("Should send forgot password OTP", async () => {
      const res = await request(app).post("/api/auth/forgot-password/send-otp").send({ phone });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("OTP sent");
    });

    it("Should verify forgot password OTP and issue reset token", async () => {
      await request(app).post("/api/auth/forgot-password/send-otp").send({ phone });
      const res = await request(app).post("/api/auth/forgot-password/verify-otp").send({ phone, otp: "111111" });
      expect(res.status).toBe(200);
      expect(res.body.resetToken).toBeDefined();
    });

    it("Should reset password with reset token", async () => {
      await request(app).post("/api/auth/forgot-password/send-otp").send({ phone });
      const verifyRes = await request(app).post("/api/auth/forgot-password/verify-otp").send({ phone, otp: "111111" });
      const { resetToken } = verifyRes.body;

      const res = await request(app)
        .post("/api/auth/forgot-password/reset")
        .set("Authorization", `Bearer ${resetToken}`)
        .send({ password: "NewPassword@123" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Password reset successfully");

      // Verify signin works with new password (if we had password login)
    });
  });
});
