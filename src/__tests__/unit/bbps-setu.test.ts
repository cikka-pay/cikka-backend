import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../app";

describe("Setu BBPS & UAT Check Status Integration", () => {
  describe("POST /setu/v1/getPaymentStatus (UAT Check Status URL)", () => {
    it("should accept Setu webhook payload with refId and without authorization header", async () => {
      const setuWebhookPayload = {
        mobileNumber: "9002198484",
        status: "FETCH_SUCCESS",
        billId: "0558847476",
        billerId: "AVVNL0000RAJ01",
        billerName: "Ajmer Vidyut Vitran Nigam Limited (AVVNL)",
        billerCategory: "Electricity",
        sessionId: "2034435914037462453",
        event: "bill_fetch_success",
        refId: "DACKPTKMMJ0S7399F6AGzWLnh9362461603",
        billAmount: "6067.00",
        billNumber: "8021881734351724651",
        billDate: "2026-08-31",
        customerName: "Joseph Taylor",
        dueDate: "2026-09-13",
        billDetails: [
          {
            billAmount: "6067.00",
            billNumber: "8021881734351724651",
            billDate: "2026-08-31",
            customerName: "Joseph Taylor",
            dueDate: "2026-09-13"
          }
        ]
      };

      const res = await request(app)
        .post("/setu/v1/getPaymentStatus")
        .send(setuWebhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.refId).toBe("DACKPTKMMJ0S7399F6AGzWLnh9362461603");
    });

    it("should accept valid payment status webhook and record payment idempotently", async () => {
      const authHeader = `Basic ${Buffer.from("setu_user:setu_secret_pass").toString("base64")}`;
      const payload = {
        uniquePaymentRefID: `UAT_SETU_REF_${Date.now()}`,
        status: "SUCCESS",
        amount: 1500.50,
        userId: "user_uat_test",
      };

      // First call (New transaction)
      const res1 = await request(app)
        .post("/setu/v1/getPaymentStatus")
        .set("Authorization", authHeader)
        .send(payload);

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      expect(res1.body.uniquePaymentRefID).toBe(payload.uniquePaymentRefID);
      expect(res1.body.isDuplicate).toBe(false);

      // Second call (Idempotent duplicate check)
      const res2 = await request(app)
        .post("/setu/v1/getPaymentStatus")
        .set("Authorization", authHeader)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.isDuplicate).toBe(true);
    });
  });

  describe("BBPS Endpoints (/api/bbps/*)", () => {
    it("GET /api/bbps/categories should return list of BBPS biller categories", async () => {
      const res = await request(app).get("/api/bbps/categories");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories).toContain("ELECTRICITY");
    });

    it("GET /api/bbps/billers should return billers filtered by category", async () => {
      const res = await request(app).get("/api/bbps/billers?category=ELECTRICITY");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.billers)).toBe(true);
      expect(res.body.billers.length).toBeGreaterThan(0);
      expect(res.body.billers[0].category).toBe("ELECTRICITY");
    });

    it("POST /api/bbps/fetch-bill should fetch live bill details", async () => {
      const payload = {
        billerId: "BESCOM000KAR01",
        customerParams: { accountNumber: "1234567890" },
      };

      const res = await request(app).post("/api/bbps/fetch-bill").send(payload);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.bill.billerId).toBe(payload.billerId);
      expect(res.body.bill.billAmount).toBeGreaterThan(0);
    });

    it("POST /api/bbps/create-payment-order should generate Setu payment order & link", async () => {
      const payload = {
        billerId: "BESCOM000KAR01",
        amount: 850.0,
        paymentMode: "UPI",
      };

      const res = await request(app).post("/api/bbps/create-payment-order").send(payload);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.order.uniquePaymentRefID).toBeDefined();
      expect(res.body.order.setuPaymentLink).toBeDefined();
    });
  });
});
