import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Onboarding Integration Tests", () => {
  const phone = "+919000000123";
  let token = "";

  beforeEach(async () => {
    await cleanTestData([phone]);
    // Create a seller who has just signed up (INCOMPLETE)
    const res = await createTestSeller({ phone, businessName: "" });
    token = res.token;
    await prisma.seller.update({
      where: { phone },
      data: { onboardingStatus: "INCOMPLETE" },
    });
  });

  describe("GET /api/onboarding", () => {
    it("Should return null or empty state if onboarding hasn't started", async () => {
      const res = await request(app)
        .get("/api/onboarding")
        .set("Authorization", `Bearer ${token}`);
      
      expect(res.status).toBe(200);
      expect(res.body.onboarding).toBeNull();
    });
  });

  describe("PATCH /api/onboarding/step/1 (Business Info)", () => {
    it("Should create onboarding record and save business info", async () => {
      const res = await request(app)
        .patch("/api/onboarding/step/1")
        .set("Authorization", `Bearer ${token}`)
        .send({
          businessName: "Test Shop",
          businessType: "PRIVATE_LIMITED",
          yearEstablished: 2020,
          businessCategory: "Electronics",
          description: "A test shop",
          website: "https://testshop.com",
        });

      expect(res.status).toBe(200);
      expect(res.body.completedSteps).toBe(1);
      
      // Verify seller table businessName sync
      const seller = await prisma.seller.findUnique({ where: { phone } });
      expect(seller?.businessName).toBe("Test Shop");
    });
  });

  describe("KYB Endpoints & Step 2", () => {
    beforeEach(async () => {
      await request(app)
        .patch("/api/onboarding/step/1")
        .set("Authorization", `Bearer ${token}`)
        .send({ businessName: "Test Shop", businessType: "PRIVATE_LIMITED" });
    });

    it("Should verify GST via stub", async () => {
      const res = await request(app)
        .post("/api/onboarding/kyb/verify-gst")
        .set("Authorization", `Bearer ${token}`)
        .send({ gstNumber: "27AADCB2230M1Z2" });
      
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.businessName).toBeDefined();
    });

    it("Should save Step 2 data", async () => {
      const res = await request(app)
        .patch("/api/onboarding/step/2")
        .set("Authorization", `Bearer ${token}`)
        .send({
          gstNumber: "27AADCB2230M1Z2",
          panNumber: "AADCB2230M",
          cinNumber: "U72200MH2020PTC123456",
        });

      expect(res.status).toBe(200);
      expect(res.body.completedSteps).toBe(2);
    });
  });

  describe("Aadhaar eKYC & Step 3", () => {
    beforeEach(async () => {
      await request(app).patch("/api/onboarding/step/1").set("Authorization", `Bearer ${token}`).send({ businessName: "Test Shop" });
    });

    it("Should send Aadhaar OTP", async () => {
      const res = await request(app)
        .post("/api/onboarding/kyb/send-aadhaar-otp")
        .set("Authorization", `Bearer ${token}`)
        .send({ aadhaar: "123456789012", mobile: "9999999999" });
      
      expect(res.status).toBe(200);
      expect(res.body.referenceId).toBeDefined();
    });

    it("Should verify Aadhaar OTP with bypass code", async () => {
      const res = await request(app)
        .post("/api/onboarding/kyb/verify-aadhaar-otp")
        .set("Authorization", `Bearer ${token}`)
        .send({ referenceId: "STUB", otp: "111111" });
      
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it("Should save Step 3 data", async () => {
      const res = await request(app)
        .patch("/api/onboarding/step/3")
        .set("Authorization", `Bearer ${token}`)
        .send({
          signatoryName: "John Doe",
          signatoryTitle: "Director",
          signatoryPersonalPan: "ABCDE1234F",
          signatoryAadhaar: "123456789012",
          signatoryMobile: "9999999999",
          signatoryEmail: "john@test.com",
        });

      expect(res.status).toBe(200);
      expect(res.body.completedSteps).toBe(3);
    });
  });

  describe("Bank Verification & Step 4", () => {
    beforeEach(async () => {
      await request(app).patch("/api/onboarding/step/1").set("Authorization", `Bearer ${token}`).send({ businessName: "Test Shop" });
    });

    it("Should verify bank account via penny drop stub", async () => {
      const res = await request(app)
        .post("/api/onboarding/kyb/verify-bank")
        .set("Authorization", `Bearer ${token}`)
        .send({ ifsc: "HDFC0001234", accountNumber: "1234567890" });
      
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });

    it("Should save Step 4 data", async () => {
      const res = await request(app)
        .patch("/api/onboarding/step/4")
        .set("Authorization", `Bearer ${token}`)
        .send({
          bankAccountHolder: "Test Shop Pvt Ltd",
          bankName: "HDFC Bank",
          bankAccountNumber: "1234567890",
          bankIfsc: "HDFC0001234",
        });

      expect(res.status).toBe(200);
      expect(res.body.completedSteps).toBe(4);
    });
  });

  describe("Step 5 & 6 and Submit", () => {
    beforeEach(async () => {
      await request(app).patch("/api/onboarding/step/1").set("Authorization", `Bearer ${token}`).send({ businessName: "Test Shop" });
      await request(app).patch("/api/onboarding/step/2").set("Authorization", `Bearer ${token}`).send({ gstNumber: "123" });
      await request(app).patch("/api/onboarding/step/3").set("Authorization", `Bearer ${token}`).send({ signatoryName: "John" });
      await request(app).patch("/api/onboarding/step/4").set("Authorization", `Bearer ${token}`).send({ bankName: "HDFC" });
    });

    it("Should save Step 5 data", async () => {
      const res = await request(app)
        .patch("/api/onboarding/step/5")
        .set("Authorization", `Bearer ${token}`)
        .send({
          productCategories: ["Electronics"],
          returnPolicy: "7-Day Return Window",
          settlementCycle: "T_PLUS_7",
          fulfillmentType: "THREE_PL",
          pickupAddress: { line1: "123 Street", city: "Mumbai", state: "MH", pincode: "400001" },
        });

      expect(res.status).toBe(200);
      expect(res.body.completedSteps).toBe(5);
    });

    it("Should save Step 6 data", async () => {
      const res = await request(app)
        .patch("/api/onboarding/step/6")
        .set("Authorization", `Bearer ${token}`)
        .send({
          merchantAgreementAccepted: true,
          commissionAcknowledged: true,
          returnPolicyAcknowledged: true,
          authenticityAcknowledged: true,
          digitalSignature: "John Doe Signature",
        });

      expect(res.status).toBe(200);
      expect(res.body.completedSteps).toBe(6);
    });

    it("Should submit application and generate application ID", async () => {
      // Must be at step 6 to submit
      await request(app).patch("/api/onboarding/step/5").set("Authorization", `Bearer ${token}`).send({ returnPolicy: "7-Day Return Window" });
      await request(app).patch("/api/onboarding/step/6").set("Authorization", `Bearer ${token}`).send({ merchantAgreementAccepted: true });

      const res = await request(app)
        .post("/api/onboarding/submit")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.applicationId).toMatch(/^CKA-\d{4}-\d{5}$/);
      expect(res.body.status).toBe("SUBMITTED");

      // Verify seller status updated
      const seller = await prisma.seller.findUnique({ where: { phone } });
      expect(seller?.onboardingStatus).toBe("SUBMITTED");
    });
  });
});
