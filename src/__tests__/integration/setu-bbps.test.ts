import { describe, it, expect, afterEach } from "vitest";
import supertest from "supertest";
import app from "../../app";
import { prisma } from "../../config/prisma";

const setuAuthHeader = "Basic " + Buffer.from("setu_user:setu_secret_pass").toString("base64");

describe("Setu BBPS & Check Status Integration Tests", () => {
  const testRefID = `CKK-TEST-BBPS-${Date.now()}`;

  afterEach(async () => {
    await prisma.bbpsTransaction.deleteMany({
      where: { refID: { contains: "CKK-TEST-BBPS" } },
    });
    await prisma.paymentTransaction.deleteMany({
      where: { uniquePaymentRefID: { contains: "CKK-TEST-BBPS" } },
    });
  });

  describe("Setu Gateway Webhooks & Check Status URL", () => {
    it("should respond to Check Status URL (POST /setu/v1/checkStatus)", async () => {
      const res = await supertest(app)
        .post("/setu/v1/checkStatus")
        .set("Authorization", setuAuthHeader)
        .send({ uniquePaymentRefID: testRefID });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uniquePaymentRefID).toBe(testRefID);
      expect(res.body.status).toBeDefined();
    });

    it("should record payment status webhook (POST /setu/v1/getPaymentStatus)", async () => {
      const res = await supertest(app)
        .post("/setu/v1/getPaymentStatus")
        .set("Authorization", setuAuthHeader)
        .send({
          uniquePaymentRefID: testRefID,
          status: "SUCCESS",
          amount: 1450,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uniquePaymentRefID).toBe(testRefID);
      expect(res.body.isDuplicate).toBe(false);

      // Verify idempotency on duplicate call
      const resDup = await supertest(app)
        .post("/setu/v1/getPaymentStatus")
        .set("Authorization", setuAuthHeader)
        .send({
          uniquePaymentRefID: testRefID,
          status: "SUCCESS",
          amount: 1450,
        });

      expect(resDup.status).toBe(200);
      expect(resDup.body.isDuplicate).toBe(true);
    });

    it("should reject unauthorized Setu requests without valid Basic Auth", async () => {
      const res = await supertest(app)
        .post("/setu/v1/checkStatus")
        .set("Authorization", "Basic invalid_credentials")
        .send({ uniquePaymentRefID: testRefID });

      expect(res.status).toBe(401);
    });
  });

  describe("Customer BBPS APIs (/api/bbps)", () => {
    it("should fetch biller categories", async () => {
      const res = await supertest(app).get("/api/bbps/categories");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.categories.length).toBeGreaterThan(0);
    });

    it("should fetch billers for a category", async () => {
      const res = await supertest(app).get("/api/bbps/billers?category=ELECTRICITY");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.billers.length).toBeGreaterThan(0);
    });

    it("should fetch bill details for a consumer", async () => {
      const res = await supertest(app)
        .post("/api/bbps/bills/fetch")
        .send({
          billerId: "BESCOM000KAR01",
          customerParams: { consumer_number: "9876543210" },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.billDetails.billAmount).toBe(1450);
    });

    it("should initiate BBPS bill payment", async () => {
      const res = await supertest(app)
        .post("/api/bbps/payments/initiate")
        .send({
          refID: testRefID,
          billerId: "BESCOM000KAR01",
          billerName: "BESCOM Electricity",
          category: "ELECTRICITY",
          amount: 1450.0,
          customerParams: { consumer_number: "9876543210" },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.payment.refID).toBe(testRefID);
      expect(res.body.payment.status).toBe("SUCCESS");

      // Verify status check endpoint returns recorded transaction
      const statusRes = await supertest(app)
        .get(`/api/bbps/payments/${testRefID}/status`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.transaction.status).toBe("SUCCESS");
    });
  });
});
