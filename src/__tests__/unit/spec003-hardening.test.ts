/**
 * Spec 003 unit coverage: pricing helpers and quote ids, seller payability, CORS allowlist,
 * 404 for unknown /api paths (seller routes still 401), settlement accounting for mall lines.
 */
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { config } from "../../config/env";
import { isOriginAllowed, parseAllowlist } from "../../config/cors";
import {
  PricedCart,
  decimalToPaise,
  parsePricingRequest,
  sellerLinkedAccount,
  signQuote,
  verifyQuote,
  PricingError,
} from "../../services/mallPricing.service";
import { calculateSettlementBreakdown } from "../../services/settlementCalculator.service";
import { expectedRewardsFeePaise } from "../../services/checkoutFulfilment.service";

const ORIGINAL_CORS = process.env.CORS_ORIGIN;
const ORIGINAL_PROD = config.isProduction;
afterEach(() => {
  if (ORIGINAL_CORS === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = ORIGINAL_CORS;
  (config as any).isProduction = ORIGINAL_PROD;
});

function cart(overrides: Partial<PricedCart> = {}): PricedCart {
  return {
    lines: [
      {
        productId: "p1", variantId: null, variantLabel: null, name: "Shirt", brand: null, category: null, sku: "S",
        sellerId: "s1", qty: 2, unitPricePaise: 149900, mrpPaise: 199900, lineTotalPaise: 299800, lineMrpTotalPaise: 399800,
      },
    ],
    deliveryOption: "standard",
    subtotalPaise: 299800,
    mrpTotalPaise: 399800,
    couponPaise: 0,
    cashbackPaise: 0,
    ciPointsPaise: 0,
    expressFeePaise: 0,
    platformFeePaise: 0,
    platformFeeGstPaise: 0,
    exchange: null,
    totalPaise: 299800,
    cashbackBalancePaise: null,
    notes: [],
    ...overrides,
  };
}

describe("pricing helpers", () => {
  it("converts Decimal(10,2) values to paise exactly", () => {
    expect(decimalToPaise("799.50")).toBe(79950);
    expect(decimalToPaise(0.1 + 0.2)).toBe(30);
    expect(decimalToPaise({ toFixed: () => "1499.99" })).toBe(149999);
    expect(decimalToPaise(null)).toBe(0);
  });

  it("parses the app's cart payload and drops client prices", () => {
    const parsed = parsePricingRequest({
      items: [{ id: "p1", name: "x", price: 1, qty: 2, size: "M" }],
      delivery_option: "express",
      apply_cashback: true,
      amount: 1,
    });
    expect(parsed).toEqual({
      items: [{ productId: "p1", variantId: null, qty: 2, size: "M", color: null }],
      deliveryOption: "express",
      couponCode: null,
      useCashback: true,
      useCiPoints: false,
      exchange: null,
    });
    expect(JSON.stringify(parsed)).not.toContain("price");
  });

  it.each([
    [{ items: [] }, "EMPTY_CART"],
    [{ items: [{ productId: "p1", qty: 0 }] }, "INVALID_QTY"],
    [{ items: [{ productId: "p1", qty: 21 }] }, "INVALID_QTY"],
    [{ items: [{ qty: 1 }] }, "UNKNOWN_PRODUCT"],
  ])("rejects malformed carts (%j)", (body, code) => {
    try {
      parsePricingRequest(body);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PricingError);
      expect((err as PricingError).code).toBe(code);
    }
  });

  it("only pays sellers with an activated Route account who are not suspended", () => {
    const base = { isSuspended: false, razorpayAccountId: "acc_1", razorpayAccountStatus: "ACTIVATED" };
    expect(sellerLinkedAccount(base)).toBe("acc_1");
    expect(sellerLinkedAccount({ ...base, razorpayAccountStatus: "created" })).toBeNull();
    expect(sellerLinkedAccount({ ...base, isSuspended: true })).toBeNull();
    expect(sellerLinkedAccount({ ...base, razorpayAccountId: null })).toBeNull();
    expect(
      sellerLinkedAccount({ isSuspended: false, razorpayAccountId: null, razorpayAccountStatus: null, onboarding: { razorpayAccountId: "acc_2", razorpayAccountStatus: "activated" } })
    ).toBe("acc_2");
    expect(sellerLinkedAccount(null)).toBeNull();
  });

  it("quote ids verify only for the same cart, user and time window", () => {
    const now = Date.now();
    const { quoteId } = signQuote(cart(), "u1", now);
    expect(verifyQuote(quoteId, cart(), "u1", now)).toBeNull();
    expect(verifyQuote(quoteId, cart({ totalPaise: 100 }), "u1", now)).toMatch(/changed/);
    expect(verifyQuote(quoteId, cart(), "u2", now)).toMatch(/another session/);
    expect(verifyQuote(quoteId, cart(), "u1", now + 11 * 60 * 1000)).toMatch(/expired/);
    const [payload] = quoteId.slice(2).split(".");
    expect(verifyQuote(`q_${payload}.forged`, cart(), "u1", now)).toMatch(/Invalid/);
    expect(verifyQuote("nonsense", cart(), "u1", now)).toMatch(/Malformed/);
  });

  it("rewards fee is ₹11.79, or ₹61.79 with express", () => {
    expect(expectedRewardsFeePaise(false)).toBe(1179);
    expect(expectedRewardsFeePaise(true)).toBe(6179);
  });

  it("mall settlements do not book a customer platform fee the buyer never paid", () => {
    const b = calculateSettlementBreakdown(2998, { customerPlatformFee: 0 });
    expect(b.customerPlatformTotal).toBe(0);
    expect(b.customerTotalPayment).toBe(2998);
  });
});

describe("CORS allowlist", () => {
  const list = parseAllowlist("https://seller.cikka.club, https://admin.cikka.club/");

  it("allows listed origins and requests without Origin (mobile apps)", () => {
    expect(list).toEqual(["https://seller.cikka.club", "https://admin.cikka.club"]);
    expect(isOriginAllowed("https://seller.cikka.club", list, true)).toBe(true);
    expect(isOriginAllowed(undefined, list, true)).toBe(true);
  });

  it("rejects other origins in production, including lookalikes and localhost", () => {
    expect(isOriginAllowed("https://evil.example", list, true)).toBe(false);
    expect(isOriginAllowed("https://seller.cikka.club.evil.example", list, true)).toBe(false);
    expect(isOriginAllowed("http://localhost:5173", list, true)).toBe(false);
    expect(isOriginAllowed("https://evil.example", ["*"], true)).toBe(false);
  });

  it("keeps local development working outside production", () => {
    for (const o of ["http://localhost:5173", "http://127.0.0.1:8081", "http://192.168.1.20:19006", "https://abc-def.exp.direct", "https://x1.ngrok-free.app"]) {
      expect(isOriginAllowed(o, list, false)).toBe(true);
    }
    expect(isOriginAllowed("http://localhost.evil.example", list, false)).toBe(false);
    expect(isOriginAllowed("https://evil.example", list, false)).toBe(false);
  });

  it("the app sends CORS headers only to allowed origins", async () => {
    process.env.CORS_ORIGIN = "https://seller.cikka.club";
    (config as any).isProduction = true;
    const ok = await request(app).get("/health").set("Origin", "https://seller.cikka.club");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://seller.cikka.club");
    const bad = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const app_ = await request(app).get("/health");
    expect(app_.status).toBe(200);
  });
});

describe("routing", () => {
  it.each(["/api/does-not-exist", "/api/v1/nothing/here", "/api/user/nope/x"])("unknown path %s is 404", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(404);
  });

  it.each(["/api/dashboard/summary", "/api/orders", "/api/settlements", "/api/returns", "/api/team", "/api/v1/inventory"])(
    "seller route %s still requires a seller token",
    async (url) => {
      expect((await request(app).get(url)).status).toBe(401);
    }
  );

  it("user-only routes require a user token", async () => {
    expect((await request(app).get("/api/rewards/balance?phone=9876543210")).status).toBe(401);
    expect((await request(app).get("/api/user/orders/my-orders")).status).toBe(401);
    expect((await request(app).get("/api/returns/exchange/eligibility?orderId=x")).status).toBe(401);
  });
});
