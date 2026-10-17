import { describe, it, expect, afterEach, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../app";
import { config } from "../../config/env";
import { signAdminToken } from "../../utils/jwt";
import { razorpayService } from "../../services/razorpay.service";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_PROD = config.isProduction;

// Bypasses are removed in production only; run each check as production unless stated.
const asProduction = (on = true) => {
  (config as any).isProduction = on;
  process.env.NODE_ENV = on ? "production" : "test";
};

beforeEach(() => asProduction(true));

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  (config as any).isProduction = ORIGINAL_PROD;
});

describe("Seller JWT verification", () => {
  it("rejects an unsigned (alg=none) token", async () => {
    const forged = jwt.sign({ sub: "any-seller-id", role: "seller" }, "", { algorithm: "none" as any });
    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with a publicly known dev secret", async () => {
    const forged = jwt.sign(
      { sub: "any-seller-id", role: "seller" },
      "cikka-dev-secret-do-not-use-in-production-0000000000000000"
    );
    const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });
});

describe("Admin API protection", () => {
  it("rejects admin data routes without a token", async () => {
    const res = await request(app).get("/api/admin/onboarding/applications");
    expect(res.status).toBe(401);
  });

  it("rejects admin data routes with a seller token", async () => {
    const { signToken } = await import("../../utils/jwt");
    const res = await request(app)
      .get("/api/admin/sellers/approved")
      .set("Authorization", `Bearer ${signToken("some-seller")}`);
    expect(res.status).toBe(401);
  });

  it("allows admin data routes with an admin token", async () => {
    const token = signAdminToken({ id: "super_admin_root", email: "admin@cikka.in", role: "SUPER_ADMIN" });
    const res = await request(app).get("/api/admin/sellers/approved").set("Authorization", `Bearer ${token}`);
    expect(res.status).not.toBe(401);
  });

  it.each(["123456", "admin123", "cikka2026"])("rejects hardcoded access-code alias %s", async (code) => {
    process.env.SUPER_ADMIN_ACCESS_CODE = "the-real-code";
    const res = await request(app).post("/api/admin/auth/verify-access-code").send({ accessCode: code });
    expect(res.status).toBe(401);
  });

  it("accepts the configured access code", async () => {
    process.env.SUPER_ADMIN_ACCESS_CODE = "the-real-code";
    const res = await request(app).post("/api/admin/auth/verify-access-code").send({ accessCode: "the-real-code" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("does not log in an unknown admin with the old default password", async () => {
    const res = await request(app).post("/api/admin/auth/login").send({ email: "admin@cikka.in", password: "admin123" });
    expect(res.status).toBe(401);
  });
});

describe("Payment forgery guards in production", () => {
  it("does not accept mock signatures", () => {
    process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "test_secret";
    expect(razorpayService.verifyPaymentSignature("order_dev_1", "pay_dev_1", "mock_signature_valid")).toBe(false);
  });

  it("disables the custom payment simulator", async () => {
    const res = await request(app).post("/api/payment/process-custom").send({ amount: 100, order_id: "order_x" });
    expect(res.status).toBe(501);
    expect(res.body.razorpay_signature).toBeUndefined();
  });
});

describe("Setu webhook auth", () => {
  it("rejects unauthenticated webhooks in production", async () => {
    delete process.env.SETU_STRICT_AUTH;
    const res = await request(app).post("/setu/v1/getPaymentStatus").send({ refId: "x" });
    expect(res.status).toBe(401);
  });

  it("accepts webhooks with valid basic auth in production", async () => {
    process.env.SETU_BASIC_AUTH_USER = "u";
    process.env.SETU_BASIC_AUTH_PASS = "p";
    const res = await request(app)
      .post("/setu/v1/checkStatus")
      .set("Authorization", `Basic ${Buffer.from("u:p").toString("base64")}`)
      .send({});
    expect(res.status).not.toBe(401);
  });
});

describe("Dev bypasses still work outside production", () => {
  beforeEach(() => asProduction(false));

  it("accepts a dev-secret seller token", () => {
    const token = jwt.sign({ sub: "dev-seller", role: "seller" }, "cikka-dev-secret-do-not-use-in-production-0000000000000000");
    return import("../../utils/jwt").then(({ verifySellerToken }) => {
      expect(verifySellerToken(token).sub).toBe("dev-seller");
    });
  });

  it("accepts the 123456 access-code alias", async () => {
    const res = await request(app).post("/api/admin/auth/verify-access-code").send({ accessCode: "123456" });
    expect(res.status).toBe(200);
  });

  it("accepts mock Razorpay signatures", () => {
    expect(razorpayService.verifyPaymentSignature("order_dev_1", "pay_dev_1", "mock_signature_valid")).toBe(true);
  });

  it("allows unauthenticated Setu webhooks", async () => {
    delete process.env.SETU_STRICT_AUTH;
    const res = await request(app).post("/setu/v1/checkStatus").send({});
    expect(res.status).not.toBe(401);
  });
});
