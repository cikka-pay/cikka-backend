/**
 * End-to-end Razorpay checkout against Postgres, in stub mode (no Razorpay network calls):
 * fulfilment happens once per Razorpay order across verify-payment, verify-card-otp and the
 * payment.captured / order.paid webhook, and returns refund/claw back once.
 */
import crypto from "crypto";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { razorpayService } from "../../services/razorpay.service";
import { cleanTestData, createTestSeller } from "../helpers";
import { signUserToken } from "../../utils/jwt";

const SELLER_PHONE = "+919999900077";
const USER_PHONE = "9999900078";
const PICKUP = "560099";
const KEY_SECRET = "it_key_secret";
const WEBHOOK_SECRET = "it_webhook_secret";
const ORIGINAL_ENV = { ...process.env };

const items = [{ id: "PRD-IT-1", name: "Integration Linen Shirt", price: 1499, qty: 1, originPincode: PICKUP }];
const shipping = {
  customer_name: "Asha",
  customer_phone: USER_PHONE,
  delivery_address: "12 MG Road",
  pincode: "560001",
  city: "Bengaluru",
};

let userId = "";
let userToken = "";
const orderIds: string[] = [];

const hmac = (secret: string, msg: string) => crypto.createHmac("sha256", secret).update(msg).digest("hex");

async function cleanup() {
  await prisma.razorpayCheckout.deleteMany({ where: { razorpayOrderId: { in: orderIds } } });
  await cleanTestData([SELLER_PHONE]);
  await prisma.userSavedCard.deleteMany({ where: { phone: USER_PHONE } });
  await prisma.user.deleteMany({ where: { phone: USER_PHONE } });
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

const countOrders = (orderId: string) => prisma.order.count({ where: { orderNumber: { startsWith: orderId } } });
const countSettlements = (orderId: string) => prisma.settlement.count({ where: { orderNumber: { startsWith: orderId } } });

describe("Razorpay checkout fulfilment (stub mode, Postgres)", () => {
  beforeEach(async () => {
    // Stub mode without a key id: fake orders, but a key secret so signatures are real HMACs.
    delete process.env.RAZORPAY_KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

    await cleanup();
    const { seller } = await createTestSeller({ phone: SELLER_PHONE, businessName: "IT Linen Co" });
    await prisma.sellerOnboarding.create({
      data: { sellerId: seller.id, businessName: "IT Linen Co", pickupAddress: { pincode: PICKUP, city: "Bengaluru" } as any },
    });
    const user = await prisma.user.create({ data: { phone: USER_PHONE, ciPoints: 5000 } });
    userId = user.id;
    userToken = signUserToken(user.id);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(cleanup);

  it("payment.captured fulfils an order with a recorded cart exactly once, even when redelivered", async () => {
    const created = await request(app)
      .post("/api/payment/create-order")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ amount: 149900, currency: "INR", items, ...shipping });
    expect(created.status).toBe(200);
    const orderId = created.body.order_id;
    orderIds.push(orderId);

    const first = await webhook("payment.captured", orderId, "pay_stub_it_wh1", 149900);
    expect(first.status).toBe(200);
    const again = await webhook("order.paid", orderId, "pay_stub_it_wh1", 149900);
    expect(again.status).toBe(200);
    await webhook("payment.captured", orderId, "pay_stub_it_wh1", 149900);

    expect(await countOrders(orderId)).toBe(1);
    expect(await countSettlements(orderId)).toBe(1);
    const checkout = await prisma.razorpayCheckout.findUnique({ where: { razorpayOrderId: orderId } });
    expect(checkout?.status).toBe("FULFILLED");
    expect(checkout?.fulfilledVia).toBe("WEBHOOK");
    expect(checkout?.razorpayPaymentId).toBe("pay_stub_it_wh1");
  });

  it("verify-payment and the webhook for the same payment create one order between them", async () => {
    const created = await request(app).post("/api/payment/create-order").send({ amount: 149900, currency: "INR" });
    const orderId = created.body.order_id;
    orderIds.push(orderId);
    const paymentId = "pay_stub_it_v1";

    // No cart recorded at create-order: the webhook must wait for verify, not invent an order.
    const early = await webhook("payment.captured", orderId, paymentId, 149900);
    expect(early.status).toBe(200);
    expect(await countOrders(orderId)).toBe(0);

    const verify = () =>
      request(app)
        .post("/api/payment/verify-payment")
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`),
          amount: 1, // ignored: the amount comes from the Razorpay order
          items,
          ...shipping,
        });

    const first = await verify();
    expect(first.status).toBe(200);
    expect(first.body.verified).toBe(true);
    expect(first.body.processed_orders).toHaveLength(1);
    expect(first.body.amount_paid_paise).toBe(149900);

    const second = await verify();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    await webhook("payment.captured", orderId, paymentId, 149900);

    expect(await countOrders(orderId)).toBe(1);
    expect(await countSettlements(orderId)).toBe(1);
    const order = await prisma.order.findUnique({ where: { orderNumber: orderId } });
    expect(Number(order?.totalAmount)).toBe(1499);
  });

  it("stub card flow: pay-with-card then verify-card-otp fulfils once", async () => {
    const start = await request(app)
      .post("/api/payment/pay-with-card")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ card_id: "card-x", amount: 1499, items, ...shipping });
    expect(start.status).toBe(200);
    expect(start.body.requires_otp).toBe(true);
    expect(start.body.amount_in_paise).toBe(149900);
    const { order_id, payment_id } = start.body;
    orderIds.push(order_id);

    const verify = () =>
      request(app)
        .post("/api/payment/verify-card-otp")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ order_id, payment_id, otp: "123456", amount: 1, items: [{ name: "Swapped", price: 1 }] });

    const first = await verify();
    expect(first.status).toBe(200);
    expect(first.body.razorpay_signature).toBeUndefined();
    expect(first.body.processed_orders).toHaveLength(1);
    expect((await verify()).body.duplicate).toBe(true);

    expect(await countOrders(order_id)).toBe(1);
    const order = await prisma.order.findUnique({ where: { orderNumber: order_id }, include: { items: true } });
    // The cart recorded at pay-with-card wins over what verify-card-otp sends.
    expect(Number(order?.totalAmount)).toBe(1499);
  });

  it("verify-card-otp rejects a payment id that is not a captured Razorpay payment", async () => {
    const start = await request(app)
      .post("/api/payment/pay-with-card")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ card_id: "card-x", amount: 1499, items, ...shipping });
    orderIds.push(start.body.order_id);
    process.env.RAZORPAY_KEY_ID = "rzp_test_it"; // keys present: non-stub ids go to Razorpay
    vi.spyOn(razorpayService, "fetchPayment").mockRejectedValue(new Error("The id provided does not exist"));

    const res = await request(app)
      .post("/api/payment/verify-card-otp")
      .send({ order_id: start.body.order_id, payment_id: "pay_madeup123", otp: "123456" });
    expect(res.status).toBe(400);
    expect(await countOrders(start.body.order_id)).toBe(0);
  });

  it("rewards: confirm-redemption burns points and creates the order once", async () => {
    const init = await request(app)
      .post("/api/rewards/initiate-redemption")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ productName: "Reward Mug", productValue: 800, pointsRequired: 1200, customerPhone: USER_PHONE });
    expect(init.status).toBe(200);
    expect(init.body.amount).toBe(1179);
    const orderId = init.body.order_id;
    orderIds.push(orderId);
    const paymentId = "pay_stub_it_rw1";

    const confirm = () =>
      request(app)
        .post("/api/rewards/confirm-redemption")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: hmac(KEY_SECRET, `${orderId}|${paymentId}`),
          points_burned: 1, // ignored: points were fixed at initiate-redemption
          pickup_pincode: PICKUP,
          delivery_address: "12 MG Road",
          pincode: "560001",
        });

    const first = await confirm();
    expect(first.status).toBe(200);
    expect(first.body.points_burned).toBe(1200);
    const second = await confirm();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.ciPoints).toBe(5000 - 1200);
    expect(
      await prisma.settlement.count({ where: { razorpayPaymentId: paymentId } })
    ).toBe(1);
    await prisma.order.deleteMany({ where: { orderNumber: first.body.order_id } }).catch(() => {});
  });

  it("returns: refund and transfer reversal happen once, for server-side amounts", async () => {
    const start = await request(app)
      .post("/api/payment/pay-with-card")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ card_id: "card-x", amount: 1499, items, ...shipping });
    const { order_id, payment_id } = start.body;
    orderIds.push(order_id);
    await request(app)
      .post("/api/payment/verify-card-otp")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ order_id, payment_id, otp: "123456" });

    const refund = vi.spyOn(razorpayService, "refundPayment");

    const unauthenticated = await request(app).post("/api/returns/request").send({ orderNumber: order_id });
    expect(unauthenticated.status).toBe(401);

    const first = await request(app)
      .post("/api/returns/request")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ orderNumber: order_id, refundAmount: 999999 });
    expect(first.status).toBe(201);
    expect(Number(first.body.data.refundAmount)).toBe(1499); // capped at the order total
    expect(first.body.clawbackResult?.success).toBe(true);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0][0]).toBe(payment_id);
    expect(refund.mock.calls[0][1]).toBe(149900);
    expect(refund.mock.calls[0][3]).toBe(`rtn_${first.body.data.id}`);

    const second = await request(app)
      .post("/api/returns/request")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ orderNumber: order_id });
    expect(second.status).toBe(409);
    expect(refund).toHaveBeenCalledTimes(1);

    const settlement = await prisma.settlement.findFirst({ where: { orderNumber: order_id } });
    expect(settlement?.transferStatus).toBe("REVERSED");
  });

  it("another user cannot return someone else's order", async () => {
    const start = await request(app)
      .post("/api/payment/pay-with-card")
      .set("Authorization", `Bearer ${userToken}`)
      .send({ card_id: "card-x", amount: 1499, items, ...shipping });
    orderIds.push(start.body.order_id);
    await request(app)
      .post("/api/payment/verify-card-otp")
      .send({ order_id: start.body.order_id, payment_id: start.body.payment_id, otp: "123456" });

    const res = await request(app)
      .post("/api/returns/request")
      .set("Authorization", `Bearer ${signUserToken("someone-else")}`)
      .send({ orderNumber: start.body.order_id });
    expect(res.status).toBe(403);
  });

  it("saved cards are scoped to the signed-in user", async () => {
    const other = await prisma.user.create({ data: { phone: "9999900079" } });
    try {
      const saved = await request(app)
        .post("/api/cards/save")
        .set("Authorization", `Bearer ${userToken}`)
        .send({ bankName: "HDFC Bank", cardNetwork: "Visa", last4: "1111", phone: "9876549812" });
      expect(saved.status).toBe(201);
      const card = await prisma.userSavedCard.findUnique({ where: { id: saved.body.card.id } });
      expect(card?.userId).toBe(userId);
      expect(card?.phone).toBe(USER_PHONE);

      const otherList = await request(app).get("/api/cards/saved").set("Authorization", `Bearer ${signUserToken(other.id)}`);
      expect(otherList.body.cards.map((c: any) => c.id)).not.toContain(saved.body.card.id);

      const otherDelete = await request(app)
        .delete(`/api/cards/${saved.body.card.id}`)
        .set("Authorization", `Bearer ${signUserToken(other.id)}`);
      expect(otherDelete.status).toBe(404);
    } finally {
      await prisma.userSavedCard.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});
