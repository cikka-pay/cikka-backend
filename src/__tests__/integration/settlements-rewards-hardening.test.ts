/**
 * Spec 003 §7–§8 against Postgres: settlement.processed reconciliation, REVERSED / FAILED
 * settlements excluded from payout totals, rewards balance auth, ledger as source of truth,
 * ciPoints default 0, signup bonus through the ledger and admin-only wallet credits.
 */
import crypto from "crypto";
import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { razorpayRouteService } from "../../services/razorpayRoute.service";
import { walletService } from "../../services/wallet.service";
import { grantSignupBonus } from "../../services/user-auth.service";
import { WalletTxType } from "../../generated/prisma/client";
import { cleanTestData, createTestSeller } from "../helpers";
import { signAdminToken, signUserToken } from "../../utils/jwt";

const SELLER_A = "+919999900091";
const SELLER_B = "+919999900092";
const USER_PHONE = "9999900093";
const WEBHOOK_SECRET = "it_webhook_secret_2";
const ORIGINAL_ENV = { ...process.env };

let sellerA = "";
let sellerB = "";
let tokenA = "";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

function signedWebhook(body: object) {
  const raw = JSON.stringify(body);
  return request(app)
    .post("/api/webhooks/razorpay")
    .set("Content-Type", "application/json")
    .set("X-Razorpay-Signature", crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"))
    .send(raw);
}

function settlement(sellerId: string, overrides: Record<string, unknown>) {
  return prisma.settlement.create({
    data: {
      sellerId,
      periodStart: new Date(),
      periodEnd: new Date(),
      grossSales: 1000,
      commissionAmount: 100,
      netPayable: 500,
      status: "PENDING",
      transferStatus: "ON_HOLD",
      ...overrides,
    } as any,
  });
}

async function cleanup() {
  await cleanTestData([SELLER_A, SELLER_B]);
  await prisma.user.deleteMany({ where: { phone: USER_PHONE } });
}

describe("Settlements, rewards and wallet hardening (Postgres)", () => {
  beforeEach(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    await cleanup();
    const a = await createTestSeller({ phone: SELLER_A, businessName: "Settle A" });
    const b = await createTestSeller({ phone: SELLER_B, businessName: "Settle B" });
    sellerA = a.seller.id;
    sellerB = b.seller.id;
    tokenA = a.token;
    await prisma.seller.update({ where: { id: sellerA }, data: { razorpayAccountId: "acc_it_settle_a", razorpayAccountStatus: "ACTIVATED" } });
    await prisma.seller.update({ where: { id: sellerB }, data: { razorpayAccountId: "acc_it_settle_b", razorpayAccountStatus: "ACTIVATED" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(cleanup);

  it("settlement.processed marks only the settlements whose transfers Razorpay settled", async () => {
    const paid = await settlement(sellerA, { razorpayTransferId: "trf_it_s1" });
    const otherHeld = await settlement(sellerA, { razorpayTransferId: "trf_it_s2" });
    const otherSeller = await settlement(sellerB, { razorpayTransferId: "trf_it_s3" });
    const reversed = await settlement(sellerA, { razorpayTransferId: "trf_it_s4", status: "REVERSED", transferStatus: "REVERSED" });

    const fetch = vi.spyOn(razorpayRouteService, "fetchTransfersForSettlement").mockResolvedValue([
      { id: "trf_it_s1", recipient: "acc_it_settle_a" },
      { id: "trf_it_s3", recipient: "acc_it_settle_b" }, // other account: not part of this settlement
      { id: "trf_it_s4", recipient: "acc_it_settle_a" },
    ]);

    const res = await signedWebhook({
      entity: "event",
      account_id: "acc_it_settle_a",
      event: "settlement.processed",
      payload: { settlement: { entity: { id: "setl_it_1", amount: 50000, status: "processed", utr: "UTRIT001" } } },
    });
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("setl_it_1");

    const rows = await prisma.settlement.findMany({ where: { id: { in: [paid.id, otherHeld.id, otherSeller.id, reversed.id] } } });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[paid.id]).toMatchObject({ status: "PAID", transferStatus: "SETTLED", utr: "UTRIT001", recipientSettlementId: "setl_it_1" });
    expect(byId[otherHeld.id]).toMatchObject({ status: "PENDING", transferStatus: "ON_HOLD" });
    expect(byId[otherSeller.id]).toMatchObject({ status: "PENDING", transferStatus: "ON_HOLD" });
    expect(byId[reversed.id]).toMatchObject({ status: "REVERSED" });
  });

  it("settlement.processed answers 500 (so Razorpay retries) and marks nothing if transfers cannot be fetched", async () => {
    const held = await settlement(sellerA, { razorpayTransferId: "trf_it_s5" });
    vi.spyOn(razorpayRouteService, "fetchTransfersForSettlement").mockRejectedValue(new Error("Razorpay down"));
    const res = await signedWebhook({
      account_id: "acc_it_settle_a",
      event: "settlement.processed",
      payload: { settlement: { entity: { id: "setl_it_2", utr: "UTRIT002" } } },
    });
    expect(res.status).toBe(500);
    expect((await prisma.settlement.findUnique({ where: { id: held.id } }))?.status).toBe("PENDING");
  });

  it("transfer.failed and transfer.reversed take settlements out of the payable set", async () => {
    const failed = await settlement(sellerA, { razorpayTransferId: "trf_it_f1" });
    const reversed = await settlement(sellerA, { razorpayTransferId: "trf_it_r1" });
    await signedWebhook({ event: "transfer.failed", payload: { transfer: { entity: { id: "trf_it_f1" } } } });
    await signedWebhook({ event: "transfer.reversed", payload: { reversal: { entity: { transfer_id: "trf_it_r1" } } } });
    // A late transfer.processed must not resurrect the reversed row.
    await signedWebhook({ event: "transfer.processed", payload: { transfer: { entity: { id: "trf_it_r1", on_hold: false } } } });

    expect((await prisma.settlement.findUnique({ where: { id: failed.id } }))?.status).toBe("FAILED");
    expect((await prisma.settlement.findUnique({ where: { id: reversed.id } }))?.status).toBe("REVERSED");
  });

  it("REVERSED and FAILED settlements are excluded from dashboard payout totals and breakdown", async () => {
    await settlement(sellerA, { netPayable: 500, grossSales: 1000 });
    await settlement(sellerA, { netPayable: 300, grossSales: 700, status: "REVERSED", transferStatus: "REVERSED" });
    await settlement(sellerA, { netPayable: 200, grossSales: 400, status: "FAILED", transferStatus: "FAILED" });

    const summary = await request(app).get("/api/dashboard/summary").set(auth(tokenA));
    expect(summary.status).toBe(200);
    expect(summary.body.netPayoutPending).toBe(500);

    const breakdown = await request(app).get("/api/dashboard/settlement-breakdown?period=this_week").set(auth(tokenA));
    expect(breakdown.status).toBe(200);
    expect(breakdown.body.grossSales).toBe(1000);

    const list = await request(app).get("/api/settlements?status=REVERSED").set(auth(tokenA));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it("seller withdraw / disburse endpoints are retired", async () => {
    const s = await settlement(sellerB, {});
    expect((await request(app).post("/api/settlements/withdraw").set(auth(tokenA)).send({ amount: 100000 })).status).toBe(410);
    expect((await request(app).post(`/api/settlements/${s.id}/disburse`).set(auth(tokenA)).send({})).status).toBe(410);
    expect(await prisma.settlement.count({ where: { sellerId: sellerA } })).toBe(0);
  });

  it("rewards balance needs the user's own token, reads the ledger and ignores ?phone=", async () => {
    const user = await prisma.user.create({ data: { phone: USER_PHONE } });
    expect(user.ciPoints).toBe(0); // no more 100000 default

    expect((await request(app).get(`/api/rewards/balance?phone=${USER_PHONE}`)).status).toBe(401);

    await walletService.creditPoints(user.id, 750, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-bal-${user.id}` });
    await walletService.creditCash(user.id, 1250, WalletTxType.EARN_CASHBACK, { idempotencyKey: `it-balc-${user.id}` });
    const res = await request(app).get("/api/rewards/balance?phone=9876543210").set(auth(signUserToken(user.id)));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ci_points: 750, cashback_balance: 12.5, phone: USER_PHONE });

    const mirrored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(mirrored?.ciPoints).toBe(750);
    expect(Number(mirrored?.cashbackBalance)).toBe(12.5);
  });

  it("signup bonus is credited once through the ledger, and only when configured", async () => {
    const user = await prisma.user.create({ data: { phone: USER_PHONE } });
    await grantSignupBonus(user.id);
    expect((await walletService.getBalance(user.id)).ciPoints).toBe(0);

    process.env.SIGNUP_BONUS_POINTS = "250";
    await grantSignupBonus(user.id);
    await grantSignupBonus(user.id);
    expect((await walletService.getBalance(user.id)).ciPoints).toBe(250);
    expect(await prisma.loyaltyLedger.count({ where: { userId: user.id, txType: "EARN_SIGNUP" } })).toBe(1);
  });

  it("wallet credits are admin-only", async () => {
    const user = await prisma.user.create({ data: { phone: USER_PHONE } });
    const self = await request(app).post("/api/wallet/earn-points").set(auth(signUserToken(user.id))).send({ points: 100000 });
    expect(self.status).toBe(401);
    expect((await walletService.getBalance(user.id)).ciPoints).toBe(0);

    const admin = signAdminToken({ id: "admin-it", email: "ops@cikka.in", role: "SUPER_ADMIN" });
    const ok = await request(app)
      .post("/api/wallet/earn-points")
      .set(auth(admin))
      .send({ user_id: user.id, points: 100, tx_type: "EARN_ADMIN", idempotency_key: `it-adm-${user.id}` });
    expect(ok.status).toBe(200);
    expect((await walletService.getBalance(user.id)).ciPoints).toBe(100);
  });

  it("concurrent debits never take the ledger below zero", async () => {
    const user = await prisma.user.create({ data: { phone: USER_PHONE } });
    await walletService.creditPoints(user.id, 100, WalletTxType.EARN_ADMIN, { idempotencyKey: `it-cc-${user.id}` });
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) => walletService.debitPoints(user.id, 60, WalletTxType.REDEEM_REWARD, { idempotencyKey: `it-cc-d${i}-${user.id}` }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await walletService.getBalance(user.id)).ciPoints).toBe(40);
  });
});
