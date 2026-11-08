/**
 * End-to-end mall / rewards checkout against Postgres, in stub mode (no Razorpay network
 * calls). Spec 003: prices come from Product rows only, fulfilment is atomic, once per
 * Razorpay order, linked to the buyer, assigned to the product's seller and recoverable.
 */
import crypto from "crypto";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { razorpayService } from "../../services/razorpay.service";
import { razorpayRouteService } from "../../services/razorpayRoute.service";
import { walletService } from "../../services/wallet.service";
import { WalletTxType } from "../../generated/prisma/client";
import { cleanTestData, createTestSeller } from "../helpers";
import { signAdminToken, signUserToken } from "../../utils/jwt";

const SELLER_A = "+919999900077";
const SELLER_B = "+919999900080";
const SELLER_C = "+919999900081";
const USER_PHONE = "9999900078";
const OTHER_PHONE = "9999900079";
const KEY_SECRET = "it_key_secret";
const WEBHOOK_SECRET = "it_webhook_secret";
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_PROD = config.isProduction;

const shipping = {
  customer_name: "Asha",
  customer_phone: USER_PHONE,
  delivery_address: "12 MG Road",
  pincode: "560001",
  city: "Bengaluru",
};

let userId = "";
let userToken = "";
let otherId = "";
let otherToken = "";
let sellerA = "";
let sellerB = "";
const P: Record<string, string> = {};
let variantM = "";
const orderIds: string[] = [];

const hmac = (secret: string, msg: string) => crypto.createHmac("sha256", secret).update(msg).digest("hex");
const adminToken = () => signAdminToken({ id: "admin-it", email: "ops@cikka.in", role: "SUPER_ADMIN" });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function cleanup() {
  await prisma.razorpayCheckout.deleteMany({
    where: { OR: [{ razorpayOrderId: { in: orderIds } }, { userId: { in: [userId, otherId].filter(Boolean) } }] },
  });
  await cleanTestData([SELLER_A, SELLER_B, SELLER_C]);
  await prisma.userSavedCard.deleteMany({ where: { phone: { in: [USER_PHONE, OTHER_PHONE] } } });
  await prisma.user.deleteMany({ where: { phone: { in: [USER_PHONE, OTHER_PHONE] } } });
}

async function seller(phone: string, name: string, account: string | null) {
  const { seller } = await createTestSeller({ phone, businessName: name });
  await prisma.seller.update({
    where: { id: seller.id },
    data: { razorpayAccountId: account, razorpayAccountStatus: account ? "ACTIVATED" : "NOT_CREATED" },
  });
  return seller.id;
}

function webhook(event: string, orderId: string, paymentId: string, amount: number) {
  const body = JSON.stringify({
    event,
    payload: {
      payment: { entity: { id: paymentId, order_id: orderId, amount, currency: "INR", status: "captured" } },
      ...(event === "order.paid" ? { order: { entity: { id: orderId, amount, amount_paid: amount, status: "paid" } } } : {}),
    },
  });
  return request(app)
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", hmac(WEBHOOK_SECRET, body))
    .send(body);
}

const verify = (orderId: string, paymentId: string, token = userToken, extra: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/payment/verify-payment")
    .set(auth(token))
    .send({
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`),
      ...extra,
    });

async function createOrder(body: Record<string, unknown>, token: string | null = userToken) {
  const req = request(app).post("/api/payment/create-order");
  if (token) req.set(auth(token));
  const res = await req.send({ ...shipping, ...body });
  if (res.body.order_id) orderIds.push(res.body.order_id);
  return res;
}

/** Create + pay (webhook) a one-line order and return its Razorpay order id. */
async function placeOrder(items: any[], paymentId: string) {
  const created = await createOrder({ items });
  expect(created.status).toBe(200);
  const res = await verify(created.body.order_id, paymentId);
  expect(res.status).toBe(200);
  return created.body.order_id as string;
}

const ordersOf = (orderId: string) =>
  prisma.order.findMany({
    where: { OR: [{ orderNumber: orderId }, { orderNumber: { startsWith: `${orderId}-` } }] },
    include: { items: true, settlements: true },
    orderBy: { orderNumber: "asc" },
  });

describe("Mall checkout with server-side pricing (stub mode, Postgres)", () => {
  beforeEach(async () => {
    // Stub mode without a key id: fake orders/transfers, but real HMAC signatures.
    delete process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

    await cleanup();
    sellerA = await seller(SELLER_A, "IT Linen Co", "acc_it_linen");
    sellerB = await seller(SELLER_B, "IT Shoe Co", "acc_it_shoes");
    const sellerC = await seller(SELLER_C, "IT No Account Co", null);

    P.shirt = (await prisma.product.create({
      data: { sellerId: sellerA, name: "IT Linen Shirt", sku: "IT-SHIRT", price: 1499, mrp: 1999, stockQty: 10, status: "ACTIVE", category: "Apparel" },
    })).id;
    const shoe = await prisma.product.create({
      data: {
        sellerId: sellerB, name: "IT Runner", sku: "IT-SHOE", price: 799.5, stockQty: 5, status: "ACTIVE", category: "Footwear",
        variants: { create: [{ typeName: "Size", value: "M", stockQty: 2, price: 849 }] },
      },
      include: { variants: true },
    });
    P.shoe = shoe.id;
    variantM = shoe.variants[0].id;
    P.draft = (await prisma.product.create({
      data: { sellerId: sellerA, name: "IT Draft", sku: "IT-DRAFT", price: 10, stockQty: 5, status: "DRAFT" },
    })).id;
    P.unpayable = (await prisma.product.create({
      data: { sellerId: sellerC, name: "IT Orphan", sku: "IT-ORPHAN", price: 500, stockQty: 5, status: "ACTIVE" },
    })).id;
    P.cheap = (await prisma.product.create({
      data: { sellerId: sellerA, name: "IT Socks", sku: "IT-SOCKS", price: 999, stockQty: 3, status: "ACTIVE", category: "Apparel" },
    })).id;

    const user = await prisma.user.create({ data: { phone: USER_PHONE } });
    userId = user.id;
    userToken = signUserToken(user.id);
    const other = await prisma.user.create({ data: { phone: OTHER_PHONE } });
    otherId = other.id;
    otherToken = signUserToken(other.id);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    (config as any).isProduction = ORIGINAL_PROD;
  });

  afterAll(cleanup);

  // ── Quote ────────────────────────────────────────────────────────────────

  it("quote prices from the DB and ignores client prices (matches the app's cart formula)", async () => {
    const res = await request(app)
      .post("/api/mall/quote")
      .send({
        items: [
          { productId: P.shirt, qty: 2, price: 1 },
          { productId: P.shoe, variantId: variantM, qty: 1, price: 1 },
        ],
        deliveryOption: "express",
      });
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l: any) => l.unit_price)).toEqual([1499, 849]);
    expect(res.body.lines[0].line_total).toBe(2998);
    expect(res.body.lines[0].mrp_savings).toBe(1000);
    expect(res.body.lines.map((l: any) => l.seller_id)).toEqual([sellerA, sellerB]);
    // App: finalTotal = subtotal − cashback + (express ? 50 : 0)
    expect(res.body.subtotal).toBe(3847);
    expect(res.body.fees.express_delivery_fee).toBe(50);
    expect(res.body.fees.platform_fee_total).toBe(0);
    expect(res.body.total).toBe(3897);
    expect(res.body.total_paise).toBe(389700);
    expect(res.body.quote_id).toMatch(/^q_/);
  });

  it("quote applies cashback only up to ₹200 and the signed-in user's ledger balance", async () => {
    await walletService.creditCash(userId, 12345, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-cash-${userId}` });
    const body = { items: [{ productId: P.shirt, qty: 1 }], useCashback: true };

    const signedOut = await request(app).post("/api/mall/quote").send(body);
    expect(signedOut.status).toBe(401);
    expect(signedOut.body.code).toBe("AUTH_REQUIRED_FOR_CASHBACK");

    const limited = await request(app).post("/api/mall/quote").set(auth(userToken)).send(body);
    expect(limited.body.discounts.cashback).toBe(123.45);
    expect(limited.body.total_paise).toBe(149900 - 12345);

    await walletService.creditCash(userId, 50000, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-cash2-${userId}` });
    const capped = await request(app).post("/api/mall/quote").set(auth(userToken)).send({ ...body, useCiPoints: true });
    expect(capped.body.discounts.cashback).toBe(200);
    expect(capped.body.discounts.ci_points).toBe(0);
    expect(capped.body.total).toBe(1299);
  });

  it.each([
    ["unknown product", () => [{ productId: "00000000-0000-0000-0000-000000000000", qty: 1 }], 404, "UNKNOWN_PRODUCT"],
    ["unpublished product", () => [{ productId: P.draft, qty: 1 }], 409, "PRODUCT_UNAVAILABLE"],
    ["variant of another product", () => [{ productId: P.shirt, variantId: variantM, qty: 1 }], 400, "VARIANT_MISMATCH"],
    ["more than in stock", () => [{ productId: P.shoe, variantId: variantM, qty: 3 }], 409, "INSUFFICIENT_STOCK"],
    ["seller without linked account", () => [{ productId: P.unpayable, qty: 1 }], 409, "SELLER_NOT_PAYABLE"],
    ["fractional quantity", () => [{ productId: P.shirt, qty: 1.5 }], 400, "INVALID_QTY"],
  ])("quote and create-order reject %s", async (_name, items, status, code) => {
    const quote = await request(app).post("/api/mall/quote").send({ items: items() });
    expect(quote.status).toBe(status);
    expect(quote.body.code).toBe(code);
    const created = await createOrder({ items: items() });
    expect(created.status).toBe(status);
    expect(created.body.code).toBe(code);
  });

  it("rejects coupon codes (no server-side coupons exist)", async () => {
    const res = await request(app).post("/api/mall/quote").send({ items: [{ productId: P.shirt, qty: 1 }], couponCode: "FLAT50" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("COUPON_INVALID");
  });

  // ── create-order ─────────────────────────────────────────────────────────

  it("create-order charges the server total and refuses a tampered client amount", async () => {
    const tampered = await createOrder({ amount: 100, items: [{ id: P.shirt, name: "x", price: 1, qty: 1 }] });
    expect(tampered.status).toBe(409);
    expect(tampered.body.code).toBe("PRICE_CHANGED");
    expect(tampered.body.quote.total_paise).toBe(149900);

    const ok = await createOrder({ amount: 149900, items: [{ id: P.shirt, price: 1, qty: 1 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.amount).toBe(149900);
    const checkout = await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: ok.body.order_id } });
    expect(checkout?.amountPaise).toBe(149900);
    expect((checkout?.snapshot as any).pricing.lines[0].unitPricePaise).toBe(149900);
    expect(checkout?.userId).toBe(userId);
  });

  it("create-order honours a valid quote_id and rejects a stale one", async () => {
    const quote = await request(app).post("/api/mall/quote").set(auth(userToken)).send({ items: [{ productId: P.shirt, qty: 1 }] });
    const ok = await createOrder({ items: [{ productId: P.shirt, qty: 1 }], quote_id: quote.body.quote_id });
    expect(ok.status).toBe(200);

    await prisma.product.update({ where: { id: P.shirt }, data: { price: 1599 } });
    const stale = await createOrder({ items: [{ productId: P.shirt, qty: 1 }], quote_id: quote.body.quote_id });
    expect(stale.status).toBe(409);
    expect(stale.body.quote.total).toBe(1599);
  });

  it("requires a signed-in buyer in production", async () => {
    (config as any).isProduction = true;
    const res = await createOrder({ items: [{ productId: P.shirt, qty: 1 }] }, null);
    expect(res.status).toBe(401);
  });

  // ── Fulfilment ───────────────────────────────────────────────────────────

  it("webhook fulfils a multi-seller cart once: right sellers, server prices, user, stock, cashback", async () => {
    await walletService.creditCash(userId, 10000, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-cash3-${userId}` });
    const created = await createOrder({
      items: [
        { productId: P.shirt, qty: 2, price: 1 },
        { productId: P.shoe, variantId: variantM, qty: 1 },
      ],
      useCashback: true,
      delivery_option: "express",
    });
    expect(created.status).toBe(200);
    const total = 2 * 149900 + 84900 - 10000 + 5000;
    expect(created.body.amount).toBe(total);
    const orderId = created.body.order_id;

    for (const ev of ["payment.captured", "order.paid", "payment.captured"]) {
      expect((await webhook(ev, orderId, "pay_stub_it_multi", total)).status).toBe(200);
    }

    const orders = await ordersOf(orderId);
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => o.sellerId)).toEqual([sellerA, sellerB]);
    expect(orders.every((o) => o.userId === userId)).toBe(true);
    expect(orders[0].items[0]).toMatchObject({ productId: P.shirt, quantity: 2 });
    expect(Number(orders[0].items[0].unitPrice)).toBe(1499);
    expect(Number(orders[0].totalAmount)).toBe(2998);
    expect(Number(orders[1].items[0].unitPrice)).toBe(849);
    expect(orders[1].items[0].variantId).toBe(variantM);
    expect(Number(orders[0].settlements[0].grossSales)).toBe(2998);
    expect(Number(orders[0].settlements[0].customerPlatformFee)).toBe(0);
    expect(orders.every((o) => o.settlements[0].transferStatus === "ON_HOLD" && o.settlements[0].razorpayTransferId)).toBe(true);

    expect((await prisma.product.findUnique({ where: { id: P.shirt } }))?.stockQty).toBe(8);
    expect((await prisma.productVariant.findUnique({ where: { id: variantM } }))?.stockQty).toBe(1);
    const balance = await walletService.getBalance(userId);
    expect(balance.cashPaise).toBe(0);
    expect(Number((await prisma.user.findUnique({ where: { id: userId } }))?.cashbackBalance)).toBe(0);

    const checkout = await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } });
    expect(checkout).toMatchObject({ status: "FULFILLED", fulfilledVia: "WEBHOOK", stage: "COMPLETED", attempts: 1 });
  });

  it("verify-payment and the webhook for the same payment create one order between them", async () => {
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }] });
    const orderId = created.body.order_id;
    const first = await verify(orderId, "pay_stub_it_v1", userToken, { items: [{ productId: P.cheap, qty: 5 }], amount: 1 });
    expect(first.status).toBe(200);
    expect(first.body.processed_orders).toHaveLength(1);
    expect(first.body.processed_orders[0]).toMatchObject({ product_id: P.shirt, seller_id: sellerA, unit_price: 1499 });
    expect((await verify(orderId, "pay_stub_it_v1")).body.duplicate).toBe(true);
    await webhook("payment.captured", orderId, "pay_stub_it_v1", 149900);
    expect(await ordersOf(orderId)).toHaveLength(1);
  });

  it("another user cannot verify someone else's payment", async () => {
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }] });
    const res = await verify(created.body.order_id, "pay_stub_it_wrong", otherToken);
    expect(res.status).toBe(403);
    expect(await ordersOf(created.body.order_id)).toHaveLength(0);
  });

  it("a cart that cannot be fulfilled in full is refunded, with nothing written", async () => {
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }, { productId: P.cheap, qty: 3 }] });
    const orderId = created.body.order_id;
    await prisma.product.update({ where: { id: P.cheap }, data: { stockQty: 1 } }); // sold elsewhere meanwhile
    const refund = vi.spyOn(razorpayService, "refundPayment");

    const res = await verify(orderId, "pay_stub_it_oos");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ refunded: true, code: "INSUFFICIENT_STOCK" });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0][1]).toBe(149900 + 3 * 99900);
    expect(refund.mock.calls[0][3]).toBe(`ful_${orderId}`);

    expect(await ordersOf(orderId)).toHaveLength(0);
    expect((await prisma.product.findUnique({ where: { id: P.shirt } }))?.stockQty).toBe(10); // rolled back
    expect((await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } }))?.status).toBe("REFUNDED");
    // Redelivery does not try again.
    await webhook("payment.captured", orderId, "pay_stub_it_oos", 149900 + 3 * 99900);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("a checkout stuck in PROCESSING (crash) is resumed by a webhook redelivery once its lease expires", async () => {
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }] });
    const orderId = created.body.order_id;
    await prisma.razorpayCheckout.update({
      where: { razorpayOrderId: orderId },
      data: { status: "PROCESSING", razorpayPaymentId: "pay_stub_it_crash", leaseExpiresAt: new Date(Date.now() + 60000), attempts: 1 },
    });

    const live = await verify(orderId, "pay_stub_it_crash");
    expect(live.status).toBe(202); // lease still held by the "crashed" worker
    expect(await ordersOf(orderId)).toHaveLength(0);

    await prisma.razorpayCheckout.update({ where: { razorpayOrderId: orderId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    expect((await webhook("payment.captured", orderId, "pay_stub_it_crash", 149900)).status).toBe(200);
    expect(await ordersOf(orderId)).toHaveLength(1);
    const row = await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } });
    expect(row).toMatchObject({ status: "FULFILLED", attempts: 2 });
  });

  it("orders committed but transfers not made are completed by the admin resume endpoint, without duplicates", async () => {
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }] });
    const orderId = created.body.order_id;
    const transfer = vi.spyOn(razorpayRouteService, "transferPaymentWithT7Hold").mockResolvedValueOnce({ success: false, error: "gateway timeout" });

    expect((await verify(orderId, "pay_stub_it_resume")).status).toBe(200);
    let settlement = (await ordersOf(orderId))[0].settlements[0];
    expect(settlement.transferStatus).toBe("TRANSFER_FAILED");
    expect((await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } }))?.stage).toBe("DB_COMMITTED");

    const stuck = await request(app).get("/api/admin/checkouts").set(auth(adminToken()));
    expect(stuck.body.data.map((r: any) => r.razorpay_order_id)).toContain(orderId);
    expect((await request(app).post(`/api/admin/checkouts/${orderId}/resume`).set(auth(userToken))).status).toBe(401);

    const resumed = await request(app).post(`/api/admin/checkouts/${orderId}/resume`).set(auth(adminToken())).send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.transfers[0].status).toBe("TRANSFERRED");
    expect(transfer).toHaveBeenCalledTimes(2);
    const orders = await ordersOf(orderId);
    expect(orders).toHaveLength(1);
    settlement = orders[0].settlements[0];
    expect(settlement.transferStatus).toBe("ON_HOLD");
    expect((await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } }))?.stage).toBe("COMPLETED");
  });

  it("a transfer Razorpay already made before a crash is adopted, not repeated", async () => {
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }] });
    const orderId = created.body.order_id;
    vi.spyOn(razorpayRouteService, "transferPaymentWithT7Hold").mockResolvedValueOnce({ success: false, error: "timeout after create" });
    await verify(orderId, "pay_stub_it_adopt");
    vi.spyOn(razorpayRouteService, "fetchPaymentTransfers").mockResolvedValue([
      { id: "trf_it_existing", recipient: "acc_it_linen", on_hold: true, notes: { orderNumber: orderId } },
    ]);
    const transfer = vi.spyOn(razorpayRouteService, "transferPaymentWithT7Hold");
    const resumed = await request(app).post(`/api/admin/checkouts/${orderId}/resume`).set(auth(adminToken())).send({});
    expect(resumed.body.transfers[0].status).toBe("ADOPTED");
    expect(transfer).not.toHaveBeenCalled();
    expect((await ordersOf(orderId))[0].settlements[0].razorpayTransferId).toBe("trf_it_existing");
  });

  // ── Saved cards ──────────────────────────────────────────────────────────

  it("saved cards: listing is per user, card details are refused, another user's card cannot be used or deleted", async () => {
    const mine = await request(app).get("/api/cards/saved").set(auth(userToken));
    expect(mine.status).toBe(200);
    expect(mine.body.cards.length).toBeGreaterThan(0);
    const card = mine.body.cards[0];

    const theirs = await request(app).get("/api/cards/saved").set(auth(otherToken));
    expect(theirs.body.cards.map((c: any) => c.id)).not.toContain(card.id);

    const save = await request(app).post("/api/cards/save").set(auth(userToken)).send({ bankName: "HDFC", cardNetwork: "Visa", last4: "1111" });
    expect(save.status).toBe(410);
    expect(save.body.code).toBe("CARD_SAVE_IN_CHECKOUT");

    const steal = await request(app)
      .post("/api/payment/pay-with-card")
      .set(auth(otherToken))
      .send({ card_id: card.id, items: [{ productId: P.shirt, qty: 1 }], ...shipping });
    expect(steal.status).toBe(404);
    expect((await request(app).delete(`/api/cards/${card.id}`).set(auth(otherToken))).status).toBe(404);
    expect((await request(app).delete(`/api/cards/${card.id}`).set(auth(userToken))).status).toBe(200);
  });

  it("stub saved-card flow: pay-with-card prices on the server, verify-card-otp fulfils once", async () => {
    const card = (await request(app).get("/api/cards/saved").set(auth(userToken))).body.cards[0];
    const start = await request(app)
      .post("/api/payment/pay-with-card")
      .set(auth(userToken))
      .send({ card_id: card.id, amount: 1499, items: [{ productId: P.shirt, qty: 1, price: 1 }], ...shipping });
    expect(start.status).toBe(200);
    expect(start.body.requires_otp).toBe(true);
    expect(start.body.amount_in_paise).toBe(149900);
    expect(start.body.card_last4).toBe(card.last4);
    orderIds.push(start.body.order_id);

    const otp = () =>
      request(app)
        .post("/api/payment/verify-card-otp")
        .set(auth(userToken))
        .send({ order_id: start.body.order_id, payment_id: start.body.payment_id, otp: "123456" });
    expect((await otp()).status).toBe(200);
    expect((await otp()).body.duplicate).toBe(true);
    expect(await ordersOf(start.body.order_id)).toHaveLength(1);

    const wrongAmount = await request(app)
      .post("/api/payment/pay-with-card")
      .set(auth(userToken))
      .send({ card_id: card.id, amount: 10, items: [{ productId: P.shirt, qty: 1 }] });
    expect(wrongAmount.status).toBe(409);
  });

  // ── Orders history ───────────────────────────────────────────────────────

  it("order history lists only the signed-in buyer's orders", async () => {
    const orderId = await placeOrder([{ productId: P.shirt, qty: 1 }], "pay_stub_it_hist");
    const legacy = await prisma.order.create({
      data: { sellerId: sellerA, orderNumber: `IT-LEGACY-${Date.now()}`, customerName: "Someone", totalAmount: 10 },
    });

    expect((await request(app).get("/api/user/orders/my-orders")).status).toBe(401);
    const mine = await request(app).get("/api/user/orders/my-orders?phone=9999999999").set(auth(userToken));
    expect(mine.status).toBe(200);
    expect(mine.body.orders.map((o: any) => o.id)).toEqual([orderId]);
    expect(mine.body.orders[0]).toMatchObject({ title: "IT Linen Shirt", totalAmount: 1499, status: "PENDING" });

    const theirs = await request(app).get("/api/user/orders/my-orders").set(auth(otherToken));
    expect(theirs.body.orders).toHaveLength(0);
    expect((await request(app).get(`/api/user/orders/${orderId}`).set(auth(otherToken))).status).toBe(404);
    expect((await request(app).get(`/api/user/orders/${legacy.id}`).set(auth(userToken))).status).toBe(404);
    expect((await request(app).get(`/api/user/orders/${orderId}`).set(auth(userToken))).body.order.id).toBe(orderId);
  });

  // ── Returns ──────────────────────────────────────────────────────────────

  it("returns: refund and reversal happen once; the settlement becomes REVERSED", async () => {
    const orderId = await placeOrder([{ productId: P.shirt, qty: 1 }], "pay_stub_it_rtn");
    const refund = vi.spyOn(razorpayService, "refundPayment");

    expect((await request(app).post("/api/returns/request").send({ orderNumber: orderId })).status).toBe(401);
    expect(
      (await request(app).post("/api/returns/request").set(auth(otherToken)).send({ orderNumber: orderId })).status
    ).toBe(403);

    const first = await request(app).post("/api/returns/request").set(auth(userToken)).send({ orderNumber: orderId, refundAmount: 999999 });
    expect(first.status).toBe(201);
    expect(Number(first.body.data.refundAmount)).toBe(1499);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0][1]).toBe(149900);
    expect((await request(app).post("/api/returns/request").set(auth(userToken)).send({ orderNumber: orderId })).status).toBe(409);
    expect(refund).toHaveBeenCalledTimes(1);

    const settlement = await prisma.settlement.findFirst({ where: { orderNumber: orderId } });
    expect(settlement).toMatchObject({ status: "REVERSED", transferStatus: "REVERSED" });
  });

  // ── Exchanges ────────────────────────────────────────────────────────────

  it("exchange eligibility is checked before payment and scoped to the buyer", async () => {
    const orderId = await placeOrder([{ productId: P.cheap, qty: 1 }], "pay_stub_it_exe");
    const q = (token: string, query: string) => request(app).get(`/api/returns/exchange/eligibility?${query}`).set(auth(token));

    expect((await request(app).get(`/api/returns/exchange/eligibility?orderNumber=${orderId}&newProductId=${P.shirt}`)).status).toBe(401);
    const ok = await q(userToken, `orderNumber=${orderId}&newProductId=${P.shirt}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ eligible: true, credit: 999, new_price: 1499, amount_due: 500, amount_due_paise: 50000, requires_payment: true });

    const notMine = await q(otherToken, `orderNumber=${orderId}&newProductId=${P.shirt}`);
    expect(notMine.body.eligible).toBe(false);
    expect(notMine.body.reasons.map((r: any) => r.code)).toContain("NOT_YOUR_ORDER");

    const badProduct = await q(userToken, `orderNumber=${orderId}&newProductId=${P.draft}`);
    expect(badProduct.body.reasons.map((r: any) => r.code)).toContain("PRODUCT_UNAVAILABLE");

    // An upgrade cannot be filed without paying the difference.
    const unpaid = await request(app).post("/api/returns/exchange").set(auth(userToken)).send({ orderNumber: orderId, newProductId: P.shirt });
    expect(unpaid.status).toBe(402);
    expect(unpaid.body.amount_due_paise).toBe(50000);
  });

  it("a paid exchange upgrade is charged the delta and filed during fulfilment", async () => {
    const original = await placeOrder([{ productId: P.cheap, qty: 1 }], "pay_stub_it_exo");
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }], exchange: { orderNumber: original } });
    expect(created.status).toBe(200);
    expect(created.body.amount).toBe(50000);
    expect(created.body.quote.exchange).toMatchObject({ order_number: original, credit: 999 });

    const paid = await verify(created.body.order_id, "pay_stub_it_exu");
    expect(paid.status).toBe(200);
    expect(paid.body.exchange.order_number).toBe(original);
    expect(paid.body.processed_orders).toHaveLength(0); // no second full-price order
    expect((await prisma.order.findUnique({ where: { orderNumber: original } }))?.status).toBe("EXCHANGE");

    // The app's follow-up call is answered idempotently.
    const again = await request(app).post("/api/returns/exchange").set(auth(userToken)).send({ orderNumber: original, newProductId: P.shirt });
    expect(again.status).toBe(200);
    expect(again.body.already_processed).toBe(true);
  });

  it("an exchange that became ineligible after payment is refunded instead of filed", async () => {
    const original = await placeOrder([{ productId: P.cheap, qty: 1 }], "pay_stub_it_exr");
    const created = await createOrder({ items: [{ productId: P.shirt, qty: 1 }], exchange: { orderNumber: original } });
    await request(app).post("/api/returns/request").set(auth(userToken)).send({ orderNumber: original });
    const refund = vi.spyOn(razorpayService, "refundPayment");

    const paid = await verify(created.body.order_id, "pay_stub_it_exr2");
    expect(paid.status).toBe(409);
    expect(paid.body).toMatchObject({ refunded: true, code: "EXCHANGE_NOT_ELIGIBLE" });
    expect(refund).toHaveBeenCalledWith("pay_stub_it_exr2", 50000, expect.anything(), `ful_${created.body.order_id}`);
  });

  // ── Rewards ──────────────────────────────────────────────────────────────

  it("rewards: points come from the DB price and are burned through the ledger once", async () => {
    await walletService.creditPoints(userId, 2000, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-pts-${userId}` });

    const tampered = await request(app)
      .post("/api/rewards/initiate-redemption")
      .set(auth(userToken))
      .send({ productId: P.shirt, pointsRequired: 1 });
    expect(tampered.status).toBe(409);
    expect(tampered.body.required_ci_points).toBe(1499);

    expect((await request(app).post("/api/rewards/initiate-redemption").send({ productId: P.shirt })).status).toBe(401);
    expect(
      (await request(app).post("/api/rewards/initiate-redemption").set(auth(userToken)).send({ productId: "1" })).status
    ).toBe(404);

    const init = await request(app)
      .post("/api/rewards/initiate-redemption")
      .set(auth(userToken))
      .send({ productId: P.shirt, productValue: 1, ...shipping });
    expect(init.status).toBe(200);
    expect(init.body).toMatchObject({ amount: 1179, points_required: 1499, product_value: 1499 });
    const orderId = init.body.order_id;
    orderIds.push(orderId);

    const confirm = () =>
      request(app)
        .post("/api/rewards/confirm-redemption")
        .set(auth(userToken))
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: "pay_stub_it_rw1",
          razorpay_signature: hmac(KEY_SECRET, `${orderId}|pay_stub_it_rw1`),
          points_burned: 1,
        });
    const first = await confirm();
    expect(first.status).toBe(200);
    expect(first.body.points_burned).toBe(1499);
    expect((await confirm()).body.duplicate).toBe(true);

    expect((await walletService.getBalance(userId)).ciPoints).toBe(501);
    expect((await prisma.user.findUnique({ where: { id: userId } }))?.ciPoints).toBe(501); // mirror in sync
    const order = await prisma.order.findUnique({ where: { orderNumber: first.body.order_id } });
    expect(order).toMatchObject({ userId, sellerId: sellerA });

    const balance = await request(app).get("/api/rewards/balance").set(auth(userToken));
    expect(balance.body.ci_points).toBe(501);

    const tooPoor = await request(app).post("/api/rewards/initiate-redemption").set(auth(userToken)).send({ productId: P.shirt });
    expect(tooPoor.status).toBe(400);
    expect(tooPoor.body.code).toBe("INSUFFICIENT_POINTS");
  });

  it("rewards: if points were spent elsewhere before confirm, the fee is refunded and nothing is burned", async () => {
    await walletService.creditPoints(userId, 1500, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-pts2-${userId}` });
    const init = await request(app).post("/api/rewards/initiate-redemption").set(auth(userToken)).send({ productId: P.shirt, ...shipping });
    orderIds.push(init.body.order_id);
    await walletService.debitPoints(userId, 100, WalletTxType.DEBIT_ADMIN, { idempotencyKey: `it-spend-${userId}` });

    const res = await request(app)
      .post("/api/rewards/confirm-redemption")
      .set(auth(userToken))
      .send({
        razorpay_order_id: init.body.order_id,
        razorpay_payment_id: "pay_stub_it_rw2",
        razorpay_signature: hmac(KEY_SECRET, `${init.body.order_id}|pay_stub_it_rw2`),
      });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ refunded: true, code: "INSUFFICIENT_POINTS" });
    expect((await walletService.getBalance(userId)).ciPoints).toBe(1400);
    expect(await prisma.order.count({ where: { userId } })).toBe(0);
  });
});
