/**
 * Integration tests for the wired Setu BillPay routes (spec 002) against a real Postgres:
 *   POST /api/bbps/session, POST /api/webhooks/setu/billpay, GET /api/bbps/history[/:id].
 * Runs with EXTERNAL_SERVICES_MODE=stub (the default), so Create link returns a fake link.
 * Skipped when DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { signUserToken } from "../../utils/jwt";

const RUN_ID = `ITBP${Date.now()}`;
const ORDER_ID = `${RUN_ID}-ORDER-1`;
const OTHER_ORDER_ID = `${RUN_ID}-ORDER-2`;
const API_KEY = `it-billpay-key-${RUN_ID}`;
// 10-digit Indian mobiles unique to this run
const suffix = String(Date.now()).slice(-8);
const VERIFIED_PHONE = `+9197${suffix}`;
const UNVERIFIED_PHONE = `+9196${suffix}`;
const OTHER_PHONE = `+9195${suffix}`;

describe.skipIf(!process.env.DATABASE_URL)("Setu BillPay routes (integration)", () => {
  const ORIGINAL_KEY = process.env.SETU_BILLPAY_WEBHOOK_API_KEY;
  let userId: string;
  let token: string;
  let unverifiedToken: string;
  let otherUserId: string;
  let otherToken: string;

  const paymentEvent = (event: string, orderId: string, customerId: string, extra: Record<string, string> = {}) => ({
    event,
    status: event === "bill_payment_success" ? "SUCCESS" : "FAILURE",
    txnId: `${orderId}-TXN`,
    orderId,
    refId: `${orderId}-REF`,
    sessionId: `${RUN_ID}-SESSION`,
    customerId,
    mobileNumber: VERIFIED_PHONE.slice(3),
    billerId: "BESCOM000KAR01",
    billerName: "BESCOM",
    billerCategory: "Electricity",
    billAmount: "601.00",
    amountPaid: "601.00",
    paidOn: "05-11-2026 14:03:27",
    ...extra,
  });

  const postWebhook = (body: unknown, key: string | null = API_KEY) => {
    const req = supertest(app).post("/api/webhooks/setu/billpay");
    if (key !== null) req.set("X-BILL-WEBHOOK-API-KEY", key);
    return req.send(body as object);
  };

  async function cleanup() {
    await prisma.bbpsWebhookEvent.deleteMany({ where: { dedupeKey: { contains: RUN_ID } } });
    await prisma.bbpsTransaction.deleteMany({ where: { setuOrderId: { startsWith: RUN_ID } } });
    await prisma.user.deleteMany({ where: { phone: { in: [VERIFIED_PHONE, UNVERIFIED_PHONE, OTHER_PHONE] } } });
  }

  beforeAll(async () => {
    process.env.SETU_BILLPAY_WEBHOOK_API_KEY = API_KEY;
    await cleanup();
    const verified = await prisma.user.create({ data: { phone: VERIFIED_PHONE, phoneVerified: true } });
    const unverified = await prisma.user.create({ data: { phone: UNVERIFIED_PHONE, phoneVerified: false } });
    const other = await prisma.user.create({ data: { phone: OTHER_PHONE, phoneVerified: true } });
    userId = verified.id;
    token = signUserToken(verified.id);
    unverifiedToken = signUserToken(unverified.id);
    otherUserId = other.id;
    otherToken = signUserToken(other.id);
  });

  afterAll(async () => {
    await cleanup();
    if (ORIGINAL_KEY === undefined) delete process.env.SETU_BILLPAY_WEBHOOK_API_KEY;
    else process.env.SETU_BILLPAY_WEBHOOK_API_KEY = ORIGINAL_KEY;
  });

  describe("POST /api/bbps/session", () => {
    it("returns 401 without a user JWT", async () => {
      const res = await supertest(app).post("/api/bbps/session").send({});
      expect(res.status).toBe(401);
    });

    it("returns 400 when the user's phone is not verified", async () => {
      const res = await supertest(app)
        .post("/api/bbps/session")
        .set("Authorization", `Bearer ${unverifiedToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("PHONE_NOT_VERIFIED");
    });

    it("returns a link and sessionId for a phone-verified user (stub mode)", async () => {
      const res = await supertest(app)
        .post("/api/bbps/session")
        .set("Authorization", `Bearer ${token}`)
        .send({ categoryName: "Electricity" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.link).toBe("string");
      expect(res.body.link.length).toBeGreaterThan(0);
      expect(typeof res.body.sessionId).toBe("string");
    });

    it("rejects an invalid redirectTo with 400", async () => {
      const res = await supertest(app)
        .post("/api/bbps/session")
        .set("Authorization", `Bearer ${token}`)
        .send({ redirectTo: "somewhere-else" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/webhooks/setu/billpay", () => {
    it("returns 401 without the API key", async () => {
      const res = await postWebhook(paymentEvent("bill_payment_success", ORDER_ID, userId), null);
      expect(res.status).toBe(401);
    });

    it("returns 401 with a wrong API key", async () => {
      const res = await postWebhook(paymentEvent("bill_payment_success", ORDER_ID, userId), "wrong-key");
      expect(res.status).toBe(401);
    });

    it("accepts a success event and records a SUCCESS bill payment", async () => {
      const res = await postWebhook(paymentEvent("bill_payment_success", ORDER_ID, userId));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("acknowledged");

      const row = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: ORDER_ID } });
      expect(row).not.toBeNull();
      expect(row!.userId).toBe(userId);
      expect(row!.status).toBe("SUCCESS");
      expect(row!.amountPaid?.toFixed(2)).toBe("601.00");
    });

    it("answers a re-delivery of the same event with 'duplicate' and changes nothing", async () => {
      const before = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: ORDER_ID } });
      const res = await postWebhook(paymentEvent("bill_payment_success", ORDER_ID, userId));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("duplicate");
      const after = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: ORDER_ID } });
      expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
      expect(after!.status).toBe("SUCCESS");
    });

    it("does not let a late bill_payment_failure overwrite SUCCESS", async () => {
      const res = await postWebhook(
        paymentEvent("bill_payment_failure", ORDER_ID, userId, { error: "Biller timeout" })
      );
      expect(res.status).toBe(200);
      const row = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: ORDER_ID } });
      expect(row!.status).toBe("SUCCESS");
    });

    it("records another user's payment separately", async () => {
      const res = await postWebhook(paymentEvent("bill_collection_failure", OTHER_ORDER_ID, otherUserId));
      expect(res.status).toBe(200);
      const row = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: OTHER_ORDER_ID } });
      expect(row!.userId).toBe(otherUserId);
      expect(row!.status).toBe("FAILED");
    });
  });

  describe("GET /api/bbps/history", () => {
    it("returns 401 without a user JWT", async () => {
      const res = await supertest(app).get("/api/bbps/history");
      expect(res.status).toBe(401);
    });

    it("lists the webhook-created payment for its owner only", async () => {
      const res = await supertest(app).get("/api/bbps/history").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const orderIds = res.body.history.map((h: { setuOrderId: string }) => h.setuOrderId);
      expect(orderIds).toContain(ORDER_ID);
      expect(orderIds).not.toContain(OTHER_ORDER_ID);
      const item = res.body.history.find((h: { setuOrderId: string }) => h.setuOrderId === ORDER_ID);
      expect(item).toMatchObject({
        status: "SUCCESS",
        billerName: "BESCOM",
        category: "Electricity",
        amountPaid: "601.00",
        billAmount: "601.00",
      });
    });

    it("returns one payment by id to its owner and 404 to anyone else", async () => {
      const row = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: ORDER_ID } });

      const own = await supertest(app).get(`/api/bbps/history/${row!.id}`).set("Authorization", `Bearer ${token}`);
      expect(own.status).toBe(200);
      expect(own.body.payment.id).toBe(row!.id);
      expect(own.body.payment.setuOrderId).toBe(ORDER_ID);

      const other = await supertest(app)
        .get(`/api/bbps/history/${row!.id}`)
        .set("Authorization", `Bearer ${otherToken}`);
      expect(other.status).toBe(404);
    });
  });

  // Unmatched /api/* paths fall through to the seller-auth wall in routes/index.ts (401 for a
  // user JWT); unmatched root paths get the 404 handler. Either way the old handlers are gone.
  describe("retired routes", () => {
    it.each([
      ["get", "/api/bbps/categories"],
      ["post", "/api/bbps/bills/fetch"],
      ["post", "/api/bbps/payments/initiate"],
      ["post", "/setu/v1/checkStatus"],
      ["post", "/api/setu/v1/getPaymentStatus"],
    ] as const)("%s %s is no longer served", async (method, path) => {
      const res = await supertest(app)[method](path).set("Authorization", `Bearer ${token}`).send({});
      expect([401, 404]).toContain(res.status);
      expect(res.body.success).not.toBe(true);
    });
  });
});
