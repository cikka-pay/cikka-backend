/**
 * Razorpay payment integrity: server-side payment confirmation, idempotent fulfilment,
 * mandatory webhook signatures over the raw body, and admin-only Route endpoints.
 * Prisma is replaced by an in-memory fake (razorpayCheckout only; every other model call
 * is recorded so tests can assert that no order/settlement was written).
 */
import crypto from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

type Row = Record<string, any>;

const fake = vi.hoisted(() => {
  const state = { checkouts: [] as Row[], otherCalls: [] as string[] };

  const matchStatus = (row: Row, status: any) =>
    status === undefined || (typeof status === "object" ? status.in.includes(row.status) : row.status === status);
  const matchLease = (row: Row, lease: any) =>
    lease === undefined ||
    (lease === null ? row.leaseExpiresAt == null : row.leaseExpiresAt != null && row.leaseExpiresAt < lease.lt);
  const matchWhere = (row: Row, where: any): boolean =>
    row.razorpayOrderId === where.razorpayOrderId &&
    matchStatus(row, where.status) &&
    matchLease(row, where.leaseExpiresAt) &&
    (where.stage === undefined || row.stage === where.stage) &&
    (!where.OR || where.OR.some((c: any) => matchStatus(row, c.status) && matchLease(row, c.leaseExpiresAt)));
  const applyData = (row: Row, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      row[k] = v && typeof v === "object" && "increment" in (v as any) ? (row[k] || 0) + (v as any).increment : v;
    }
  };

  const razorpayCheckout = {
    create: async ({ data }: any) => {
      if (state.checkouts.some((c) => c.razorpayOrderId === data.razorpayOrderId)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const row = { id: `chk-${state.checkouts.length + 1}`, status: "CREATED", currency: "INR", ...data };
      state.checkouts.push(row);
      return row;
    },
    findUnique: async ({ where }: any) => state.checkouts.find((c) => c.razorpayOrderId === where.razorpayOrderId) ?? null,
    upsert: async ({ where, create }: any) => {
      const existing = state.checkouts.find((c) => c.razorpayOrderId === where.razorpayOrderId);
      if (existing) return existing;
      return razorpayCheckout.create({ data: create });
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of state.checkouts) {
        if (matchWhere(row, where)) {
          applyData(row, data);
          count += 1;
        }
      }
      return { count };
    },
    update: async ({ where, data }: any) => {
      const row = state.checkouts.find((c) => c.razorpayOrderId === where.razorpayOrderId);
      if (!row) throw new Error("not found");
      applyData(row, data);
      return row;
    },
  };

  // Any other model: record the call and return an empty result.
  const other = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async () => {
          state.otherCalls.push(`${model}.${method}`);
          if (method === "findMany") return [];
          if (method === "updateMany" || method === "deleteMany") return { count: 0 };
          if (method === "count") return 0;
          return null;
        },
      }
    );

  const prisma = new Proxy({ razorpayCheckout } as Row, {
    get: (target, prop: string) => (prop in target ? target[prop] : other(prop)),
  });

  return { state, prisma };
});

vi.mock("../../config/prisma", () => ({ prisma: fake.prisma }));

import app from "../../app";
import { config } from "../../config/env";
import { razorpayService } from "../../services/razorpay.service";
import { razorpayCheckoutService, PaymentVerificationError } from "../../services/razorpayCheckout.service";
import { signAdminToken, signToken } from "../../utils/jwt";

const KEY_SECRET = "unit_test_key_secret";
const WEBHOOK_SECRET = "unit_test_webhook_secret";
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_MODE = config.externalServicesMode;
const ORIGINAL_PROD = config.isProduction;

const sign = (body: string, secret = WEBHOOK_SECRET) => crypto.createHmac("sha256", secret).update(body).digest("hex");
const paymentSignature = (orderId: string, paymentId: string) =>
  crypto.createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

function seedCheckout(overrides: Row = {}) {
  const row = {
    id: `chk-${fake.state.checkouts.length + 1}`,
    razorpayOrderId: "order_UNIT1",
    purpose: "MALL",
    userId: null,
    amountPaise: 249900,
    currency: "INR",
    status: "CREATED",
    razorpayPaymentId: null,
    snapshot: { items: [{ name: "Linen Shirt", price: 2499, qty: 1 }] },
    result: null,
    ...overrides,
  };
  fake.state.checkouts.push(row);
  return row;
}

function payment(overrides: Row = {}) {
  return {
    id: "pay_UNIT1",
    order_id: "order_UNIT1",
    amount: 249900,
    currency: "INR",
    status: "captured",
    captured: true,
    ...overrides,
  };
}

/** Real Razorpay mode (not stub), with keys, outside production. */
function realMode() {
  (config as any).externalServicesMode = "real";
  process.env.RAZORPAY_KEY_ID = "rzp_test_unit";
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
}

beforeEach(() => {
  fake.state.checkouts.length = 0;
  fake.state.otherCalls.length = 0;
  realMode();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  (config as any).externalServicesMode = ORIGINAL_MODE;
  (config as any).isProduction = ORIGINAL_PROD;
});

const wroteOrders = () => fake.state.otherCalls.some((c) => /^(order|settlement)\.(create|upsert)$/.test(c));

describe("payment signature (HMAC-SHA256 of order_id|payment_id)", () => {
  it("accepts the Razorpay signature and rejects a tampered one", () => {
    const sig = paymentSignature("order_A", "pay_B");
    expect(razorpayService.verifyPaymentSignature("order_A", "pay_B", sig)).toBe(true);
    expect(razorpayService.verifyPaymentSignature("order_A", "pay_C", sig)).toBe(false);
    expect(razorpayService.verifyPaymentSignature("order_A", "pay_B", sig.slice(0, 10))).toBe(false);
  });

  it("returns false (not an exception) when only the key id is missing", () => {
    delete process.env.RAZORPAY_KEY_ID;
    expect(razorpayService.verifyPaymentSignature("order_A", "pay_B", paymentSignature("order_A", "pay_B"))).toBe(true);
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(razorpayService.verifyPaymentSignature("order_A", "pay_B", "x")).toBe(false);
  });

  it("ignores mock signatures outside stub mode", () => {
    expect(razorpayService.verifyPaymentSignature("order_dev_1", "pay_dev_1", "mock_signature_valid")).toBe(false);
  });
});

describe("confirmCapturedPayment", () => {
  it("rejects a payment Razorpay does not know", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockRejectedValue(new Error("The id provided does not exist"));
    await expect(
      razorpayCheckoutService.confirmCapturedPayment({ orderId: "order_UNIT1", paymentId: "pay_fake", purpose: "MALL" })
    ).rejects.toMatchObject({ status: 400, code: "PAYMENT_NOT_FOUND" });
  });

  it("rejects a payment made against a different order", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ order_id: "order_OTHER" }));
    await expect(
      razorpayCheckoutService.confirmCapturedPayment({ orderId: "order_UNIT1", paymentId: "pay_UNIT1", purpose: "MALL" })
    ).rejects.toMatchObject({ code: "ORDER_MISMATCH" });
  });

  it("rejects a payment whose amount differs from the order amount", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ amount: 100 }));
    await expect(
      razorpayCheckoutService.confirmCapturedPayment({ orderId: "order_UNIT1", paymentId: "pay_UNIT1", purpose: "MALL" })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("takes the expected amount from the Razorpay order when there is no checkout record", async () => {
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ amount: 100 }));
    vi.spyOn(razorpayService, "fetchOrder").mockResolvedValue({ id: "order_UNIT1", amount: 249900, currency: "INR", status: "paid" });
    await expect(
      razorpayCheckoutService.confirmCapturedPayment({ orderId: "order_UNIT1", paymentId: "pay_UNIT1", purpose: "MALL" })
    ).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it.each(["created", "failed", "refunded"])("rejects a %s payment", async (status) => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ status, captured: false }));
    await expect(
      razorpayCheckoutService.confirmCapturedPayment({ orderId: "order_UNIT1", paymentId: "pay_UNIT1", purpose: "MALL" })
    ).rejects.toMatchObject({ status: 402, code: "PAYMENT_NOT_CAPTURED" });
  });

  it("captures an authorized payment for the full amount", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ status: "authorized", captured: false }));
    const capture = vi.spyOn(razorpayService, "capturePayment").mockResolvedValue(payment());
    const confirmed = await razorpayCheckoutService.confirmCapturedPayment({
      orderId: "order_UNIT1",
      paymentId: "pay_UNIT1",
      purpose: "MALL",
    });
    expect(capture).toHaveBeenCalledWith("pay_UNIT1", 249900, "INR");
    expect(confirmed.amountPaise).toBe(249900);
  });

  it("rejects a rewards payment presented to the mall endpoint", async () => {
    seedCheckout({ purpose: "REWARDS", amountPaise: 1179 });
    await expect(
      razorpayCheckoutService.confirmCapturedPayment({ orderId: "order_UNIT1", paymentId: "pay_UNIT1", purpose: "MALL" })
    ).rejects.toBeInstanceOf(PaymentVerificationError);
  });
});

describe("fulfilOnce", () => {
  const run = (via: "VERIFY" | "WEBHOOK", fulfil: () => Promise<any>) =>
    razorpayCheckoutService.fulfilOnce({
      orderId: "order_UNIT1",
      paymentId: "pay_UNIT1",
      purpose: "MALL",
      amountPaise: 249900,
      via,
      fulfil,
    });

  it("fulfils once when verify and the webhook race, and replays the result after", async () => {
    seedCheckout();
    let calls = 0;
    const fulfil = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { processed_orders: [{ order_number: "order_UNIT1" }] };
    };

    const [a, b] = await Promise.all([run("VERIFY", fulfil), run("WEBHOOK", fulfil)]);
    expect(calls).toBe(1);
    expect([a.state, b.state].sort()).toEqual(["FULFILLED", "IN_PROGRESS"]);

    const again = await run("WEBHOOK", fulfil);
    expect(again.state).toBe("DUPLICATE");
    expect(again.result.processed_orders).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("allows a retry after a failed attempt", async () => {
    seedCheckout();
    await expect(run("VERIFY", async () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    expect(fake.state.checkouts[0].status).toBe("FAILED");
    const retry = await run("WEBHOOK", async () => ({ ok: true }));
    expect(retry.state).toBe("FULFILLED");
  });
});

describe("POST /api/payment/verify-card-otp", () => {
  const body = { order_id: "order_UNIT1", payment_id: "pay_UNIT1", otp: "123456", amount: 1, items: [{ name: "x", price: 1 }] };

  it("rejects an unknown payment and fulfils nothing", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockRejectedValue(new Error("does not exist"));
    const res = await request(app).post("/api/payment/verify-card-otp").send(body);
    expect(res.status).toBe(400);
    expect(res.body.verified).toBe(false);
    expect(res.body.razorpay_signature).toBeUndefined();
    expect(wroteOrders()).toBe(false);
  });

  it("rejects an uncaptured payment", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ status: "failed", captured: false }));
    const res = await request(app).post("/api/payment/verify-card-otp").send(body);
    expect(res.status).toBe(402);
    expect(wroteOrders()).toBe(false);
  });

  it("rejects a payment for another order or amount", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ amount: 100 }));
    const res = await request(app).post("/api/payment/verify-card-otp").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AMOUNT_MISMATCH");
    expect(wroteOrders()).toBe(false);
  });

  it("is not a signature oracle in production (no stub, unknown payment)", async () => {
    (config as any).isProduction = true;
    vi.spyOn(razorpayService, "fetchPayment").mockRejectedValue(new Error("does not exist"));
    const res = await request(app).post("/api/payment/verify-card-otp").send({ ...body, order_id: "order_X" });
    expect(res.status).toBe(400);
    expect(res.body.razorpay_signature).toBeUndefined();
  });
});

describe("POST /api/payment/verify-payment", () => {
  it("rejects a bad signature before contacting Razorpay", async () => {
    const fetchPayment = vi.spyOn(razorpayService, "fetchPayment");
    const res = await request(app)
      .post("/api/payment/verify-payment")
      .send({ razorpay_order_id: "order_UNIT1", razorpay_payment_id: "pay_UNIT1", razorpay_signature: "bad" });
    expect(res.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  it("rejects a validly signed payment whose amount does not match the order", async () => {
    seedCheckout();
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment({ amount: 100 }));
    const res = await request(app)
      .post("/api/payment/verify-payment")
      .send({
        razorpay_order_id: "order_UNIT1",
        razorpay_payment_id: "pay_UNIT1",
        razorpay_signature: paymentSignature("order_UNIT1", "pay_UNIT1"),
        amount: 249900, // client amount is ignored
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("AMOUNT_MISMATCH");
    expect(wroteOrders()).toBe(false);
  });

  it("replays the stored result for an already fulfilled order without fulfilling again", async () => {
    seedCheckout({
      status: "FULFILLED",
      razorpayPaymentId: "pay_UNIT1",
      result: { processed_orders: [{ order_number: "order_UNIT1" }], cashback_earned: 12 },
    });
    vi.spyOn(razorpayService, "fetchPayment").mockResolvedValue(payment());
    const res = await request(app)
      .post("/api/payment/verify-payment")
      .send({
        razorpay_order_id: "order_UNIT1",
        razorpay_payment_id: "pay_UNIT1",
        razorpay_signature: paymentSignature("order_UNIT1", "pay_UNIT1"),
      });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.processed_orders).toHaveLength(1);
    expect(wroteOrders()).toBe(false);
  });
});

describe("Razorpay webhook signature", () => {
  // Deliberately not JSON.stringify's formatting, so only a raw-body check can pass.
  const rawBody = '{ "event": "transfer.processed",  "payload": { "transfer": { "entity": { "id": "trf_1", "on_hold": false } } } }';

  for (const url of ["/api/webhooks/razorpay", "/api/razorpay-route/webhook"]) {
    it(`${url}: rejects a webhook without a signature`, async () => {
      const res = await request(app).post(url).set("Content-Type", "application/json").send(rawBody);
      expect(res.status).toBe(401);
    });

    it(`${url}: rejects an invalid signature`, async () => {
      const res = await request(app)
        .post(url)
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sign(rawBody, "wrong_secret"))
        .send(rawBody);
      expect(res.status).toBe(400);
    });

    it(`${url}: accepts a valid signature over the raw body`, async () => {
      const res = await request(app)
        .post(url)
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sign(rawBody))
        .send(rawBody);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  }

  it("rejects a signature computed over re-serialised JSON instead of the raw body", async () => {
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(JSON.stringify(JSON.parse(rawBody))))
      .send(rawBody);
    expect(res.status).toBe(400);
  });

  it("rejects every webhook when no secret is configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    (config as any).razorpayWebhookSecret = undefined;
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(rawBody))
      .send(rawBody);
    expect(res.status).toBe(401);
  });

  it("acknowledges payment.captured for an order it does not know without fulfilling", async () => {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: payment({ order_id: "order_UNKNOWN" }) } },
    });
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(wroteOrders()).toBe(false);
  });

  it("does not fulfil a captured payment whose amount differs from the checkout", async () => {
    seedCheckout();
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: payment({ amount: 100 }) } },
    });
    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(fake.state.checkouts[0].status).toBe("CREATED");
    expect(wroteOrders()).toBe(false);
  });
});

describe("Razorpay Route admin endpoints", () => {
  const routes = [
    "/api/razorpay-route/disburse/some-settlement",
    "/api/razorpay-route/process-eligible-holds",
    "/api/razorpay-route/process-eligible",
    "/api/razorpay-route/create-account",
  ];

  it.each(routes)("%s requires a token", async (url) => {
    const res = await request(app).post(url).send({});
    expect(res.status).toBe(401);
  });

  it.each(routes)("%s rejects a seller token", async (url) => {
    const res = await request(app).post(url).set("Authorization", `Bearer ${signToken("seller-1")}`).send({});
    expect(res.status).toBe(401);
  });

  it("lets an admin through", async () => {
    const token = signAdminToken({ id: "admin-1", email: "ops@cikka.in", role: "SUPER_ADMIN" });
    const res = await request(app).post("/api/razorpay-route/process-eligible").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
  });

  it("no longer exposes admin actions under /api/webhooks/razorpay", async () => {
    const token = signAdminToken({ id: "admin-1", email: "ops@cikka.in", role: "SUPER_ADMIN" });
    const res = await request(app).post("/api/webhooks/razorpay/process-eligible").set("Authorization", `Bearer ${token}`).send({});
    // Not routed: unknown /api paths are 404 (no seller-auth catch-all any more).
    expect(res.status).toBe(404);
    expect(res.body.disbursedCount).toBeUndefined();
  });
});

describe("Saved cards", () => {
  it("require a signed-in user", async () => {
    expect((await request(app).get("/api/cards/saved?phone=9876549812")).status).toBe(401);
    expect((await request(app).delete("/api/cards/some-card")).status).toBe(401);
  });
});

describe("Removed simulators", () => {
  it.each(["/api/payment/process-custom", "/api/payment/process-custom-payment"])("%s is gone", async (url) => {
    const res = await request(app).post(url).send({ amount: 100 });
    // Not routed any more: unknown /api paths are 404.
    expect(res.status).toBe(404);
    expect(res.body.razorpay_signature).toBeUndefined();
  });
});

describe("stub mode is never active in production", () => {
  it("ignores EXTERNAL_SERVICES_MODE=stub when isProduction", async () => {
    const { isRazorpayStubMode } = await import("../../config/env");
    (config as any).externalServicesMode = "stub";
    expect(isRazorpayStubMode()).toBe(true);
    (config as any).isProduction = true;
    expect(isRazorpayStubMode()).toBe(false);
  });
});
