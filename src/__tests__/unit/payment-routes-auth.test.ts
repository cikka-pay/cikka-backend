/**
 * Auth on money-moving / partner routes: Razorpay Route webhook signatures,
 * operator-only disburse, Hubble coin callbacks, Shipway seller scoping,
 * the dev-only custom payment simulator, and CORS. Prisma is mocked — no DB.
 */
import crypto from "crypto";
import request from "supertest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { order, ret } = vi.hoisted(() => ({
  order: { findFirst: vi.fn(), update: vi.fn() },
  ret: { findFirst: vi.fn() },
}));

vi.mock("../../config/prisma", () => ({ prisma: { order, return: ret } }));

import app from "../../app";
import { config } from "../../config/env";
import { signAdminToken, signSellerToken } from "../../utils/jwt";
import { razorpayService } from "../../services/razorpay.service";

const sellerToken = signSellerToken("seller_1");
const adminToken = signAdminToken({ id: "admin_1", email: "a@cikka.in", role: "SUPER_ADMIN" });

let originalProduction: boolean;
let originalWebhookSecret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalProduction = config.isProduction;
  originalWebhookSecret = config.razorpayWebhookSecret;
});

afterEach(() => {
  config.isProduction = originalProduction;
  config.razorpayWebhookSecret = originalWebhookSecret;
});

describe("Razorpay Route webhook", () => {
  const body = JSON.stringify({ event: "ping.test", payload: {} });
  const sign = (secret: string) => crypto.createHmac("sha256", secret).update(body).digest("hex");

  it("rejects an unsigned event when a secret is configured", async () => {
    config.razorpayWebhookSecret = "whsec_test";
    const res = await request(app)
      .post("/api/razorpay-route/webhook")
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(400);
  });

  it("rejects a wrong signature", async () => {
    config.razorpayWebhookSecret = "whsec_test";
    const res = await request(app)
      .post("/api/razorpay-route/webhook")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign("other"))
      .send(body);
    expect(res.status).toBe(400);
  });

  it("accepts an event signed over the raw body", async () => {
    config.razorpayWebhookSecret = "whsec_test";
    const res = await request(app)
      .post("/api/razorpay-route/webhook")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", sign("whsec_test"))
      .send(body);
    expect(res.status).toBe(200);
  });

  it("rejects events in production when no secret is configured", async () => {
    config.razorpayWebhookSecret = undefined;
    config.isProduction = true;
    const res = await request(app)
      .post("/api/razorpay-route/webhook")
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(503);
  });
});

describe("Razorpay Route operator actions", () => {
  it.each([
    ["/api/razorpay-route/disburse/stl_1"],
    ["/api/razorpay-route/create-account"],
    ["/api/webhooks/razorpay/disburse/stl_1"],
  ])("POST %s requires an admin token", async (path) => {
    const noToken = await request(app).post(path).send({});
    expect(noToken.status).toBe(401);
    const asSeller = await request(app).post(path).set("Authorization", `Bearer ${sellerToken}`).send({});
    expect(asSeller.status).toBe(401);
  });
});

describe("Payments", () => {
  it("process-custom is disabled in production", async () => {
    config.isProduction = true;
    const res = await request(app).post("/api/payment/process-custom").send({ amount: 100 });
    expect(res.status).toBe(404);
    expect(res.body.razorpay_signature).toBeUndefined();
  });

  it("dev signature shortcuts are rejected in production", () => {
    config.isProduction = true;
    vi.stubEnv("RAZORPAY_KEY_SECRET", "live_secret_for_test");
    try {
      expect(razorpayService.verifyPaymentSignature("order_x", "pay_x", "mock_signature_valid")).toBe(false);
      expect(razorpayService.verifyPaymentSignature("order_dev_1", "pay_dev_1", "anything")).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses to verify with the public fallback key in production", () => {
    config.isProduction = true;
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    const saved = config.razorpayKeySecret;
    config.razorpayKeySecret = undefined;
    try {
      expect(() => razorpayService.verifyPaymentSignature("order_x", "pay_x", "sig")).toThrow();
    } finally {
      config.razorpayKeySecret = saved;
      vi.unstubAllEnvs();
    }
  });
});

describe("Hubble coin callbacks", () => {
  it("rejects calls without X-Hubble-Secret", async () => {
    const res = await request(app)
      .post("/api/hubble/debit")
      .send({ userId: "u1", coins: 1, referenceId: "ref_no_secret" });
    expect(res.status).toBe(401);
  });

  it("accepts calls with the shared secret", async () => {
    const res = await request(app)
      .post("/api/hubble/debit")
      .set("X-Hubble-Secret", process.env.HUBBLE_APP_SECRET || "cikka_staging_app_secret")
      .send({ userId: "u1", coins: 1, referenceId: "ref_with_secret" });
    expect(res.status).toBe(200);
  });
});

describe("Shipway seller routes", () => {
  it.each([
    ["post", "/api/shipway/dispatch-order"],
    ["post", "/api/shipway/ndr-action"],
    ["get", "/api/shipway/dashboard-stats"],
    ["get", "/api/shipway/label/ord_1"],
    ["post", "/api/shipway/push-order"],
  ] as const)("%s %s requires a token", async (method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it("webhook configuration requires an admin token", async () => {
    const res = await request(app).post("/api/shipway/webhooks/add").set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(401);
    const asAdmin = await request(app).post("/api/shipway/webhooks/add").set("Authorization", `Bearer ${adminToken}`);
    expect(asAdmin.status).not.toBe(401);
  });

  it("does not return another seller's label", async () => {
    order.findFirst.mockResolvedValue(null);
    const res = await request(app).get("/api/shipway/label/ord_other").set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(404);
    expect(order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sellerId: "seller_1" }) })
    );
  });

  it("does not act on another seller's NDR", async () => {
    order.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/shipway/ndr-action")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ orderId: "ord_other", action: "reattempt" });
    expect(res.status).toBe(404);
  });

  it("scopes reverse pickups to the seller's orders", async () => {
    ret.findFirst.mockResolvedValue(null);
    await request(app)
      .post("/api/shipway/reverse-pickup")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ returnId: "ret_other" });
    expect(ret.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ret_other", order: { sellerId: "seller_1" } } })
    );
  });
});

describe("CORS", () => {
  it("allows configured origins", async () => {
    const origin = config.corsOrigin.split(",")[0].trim();
    const res = await request(app).get("/health").set("Origin", origin);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("rejects lookalike hosts that the old substring checks let through", async () => {
    const res = await request(app).get("/health").set("Origin", "https://evil10.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows localhost outside production only", async () => {
    const dev = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(dev.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    config.isProduction = true;
    const prod = await request(app).get("/health").set("Origin", "http://localhost:3000");
    expect(prod.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
