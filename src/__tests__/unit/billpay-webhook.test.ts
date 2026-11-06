import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../config/prisma", async () => {
  const { fakePrisma } = await import("../billpayFakePrisma");
  return { prisma: fakePrisma.prisma };
});

vi.mock("../../services/wallet.service", async () => {
  const { fakePrisma } = await import("../billpayFakePrisma");
  const apply = (sign: 1 | -1) =>
    vi.fn(async (userId: string, points: number, txType: string, opts: { idempotencyKey?: string } = {}) => {
      const existing = fakePrisma.db.ledger.find((l) => l.idempotencyKey === opts.idempotencyKey);
      if (existing) return { ledgerEntryId: existing.id, duplicate: true };
      const row = { id: `led-${fakePrisma.db.ledger.length + 1}`, userId, txType, pointsDelta: sign * points, ...opts };
      fakePrisma.db.ledger.push(row);
      return { ledgerEntryId: row.id };
    });
  return { walletService: { creditPoints: apply(1), debitPoints: apply(-1) } };
});

import { fakePrisma } from "../billpayFakePrisma";
import { walletService } from "../../services/wallet.service";
import billpayWebhookRoutes from "../../routes/billpayWebhook.routes";
import { parseAmount, parsePaidOn, canTransition, buildDedupeKey } from "../../services/billpayWebhook.service";

const API_KEY = "test-billpay-webhook-key";
const USER_ID = "user-123";
const URL = "/api/webhooks/setu/billpay";

const app = express();
app.use(express.json());
app.use(URL, billpayWebhookRoutes);

const db = fakePrisma.db;

function base(overrides: Record<string, string> = {}) {
  return {
    orderId: "ORD-1",
    refId: "REF-1",
    sessionId: "SESS-1",
    customerId: USER_ID,
    mobileNumber: "9876543210",
    billerId: "AVVNL0000RAJ01",
    billerName: "AVVNL",
    billerCategory: "Electricity",
    billAmount: "601.00",
    amountPaid: "601.00",
    ...overrides,
  };
}

function send(body: Record<string, unknown>, key: string | null = API_KEY) {
  const req = request(app).post(URL);
  if (key !== null) req.set("X-BILL-WEBHOOK-API-KEY", key);
  return req.send(body);
}

const ENV_KEYS = ["SETU_BILLPAY_WEBHOOK_API_KEY", "BBPS_REWARDS_ENABLED", "BBPS_REWARD_POINTS_PER_100"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.SETU_BILLPAY_WEBHOOK_API_KEY = API_KEY;
  delete process.env.BBPS_REWARDS_ENABLED;
  delete process.env.BBPS_REWARD_POINTS_PER_100;
  fakePrisma.reset();
  db.users.push({ id: USER_ID });
  vi.mocked(walletService.creditPoints).mockClear();
  vi.mocked(walletService.debitPoints).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/setu/billpay — auth", () => {
  it("rejects a missing API key with 401 and stores nothing", async () => {
    const res = await send({ event: "bill_payment_success", ...base() }, null);
    expect(res.status).toBe(401);
    expect(db.events).toHaveLength(0);
  });

  it("rejects a wrong API key with 401", async () => {
    const res = await send({ event: "bill_payment_success", ...base() }, "wrong-key");
    expect(res.status).toBe(401);
    expect(db.events).toHaveLength(0);
  });

  it("rejects every delivery when no key is configured (no open bypass)", async () => {
    delete process.env.SETU_BILLPAY_WEBHOOK_API_KEY;
    const res = await send({ event: "bill_payment_success", ...base() }, "");
    expect(res.status).toBe(401);
  });

  it("accepts the right key", async () => {
    const res = await send({ event: "bill_fetch_success", ...base() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "acknowledged" });
  });

  it("400s a payload without an event", async () => {
    const res = await send({ orderId: "X" });
    expect(res.status).toBe(400);
  });
});

describe("payment events", () => {
  it.each([
    ["bill_payment_success", "SUCCESS"],
    ["bill_payment_failure", "FAILED"],
    ["bill_collection_failure", "FAILED"],
    ["bill_payment_refunded", "REFUNDED"],
  ])("%s creates the transaction as %s", async (event, status) => {
    const res = await send({ event, ...base({ txnId: "TXN-1", paidOn: "05-11-2026 14:03:27" }) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
    expect(db.txns).toHaveLength(1);
    const tx = db.txns[0];
    expect(tx.status).toBe(status);
    expect(tx.setuOrderId).toBe("ORD-1");
    expect(tx.bbpsTxnId).toBe("TXN-1");
    expect(tx.userId).toBe(USER_ID);
    expect(tx.category).toBe("Electricity");
    expect(tx.amountPaid.toFixed(2)).toBe("601.00");
    expect(tx.paidOn.toISOString()).toBe("2026-11-05T08:33:27.000Z");
    expect(db.events[0].processedAt).toBeInstanceOf(Date);
  });

  it("records the error on a failure", async () => {
    await send({ event: "bill_payment_failure", ...base({ error: '{"code":"BOU001","message":"Biller down"}' }) });
    expect(db.txns[0].errorCode).toBe("BOU001");
    expect(db.txns[0].errorMessage).toBe("Biller down");
  });

  it("leaves userId null when customerId is not one of our users", async () => {
    await send({ event: "bill_payment_success", ...base({ customerId: "someone-else" }) });
    expect(db.txns[0].userId).toBeNull();
  });

  it("does nothing on a duplicate delivery and still returns 200", async () => {
    const body = { event: "bill_payment_success", ...base({ txnId: "TXN-1" }) };
    await send(body);
    const before = { ...db.txns[0] };
    const res = await send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "duplicate" });
    expect(db.events).toHaveLength(1);
    expect(db.txns).toHaveLength(1);
    expect(db.txns[0]).toEqual(before);
  });

  it("never downgrades SUCCESS with a late bill_payment_failure", async () => {
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    const res = await send({ event: "bill_payment_failure", ...base({ txnId: "TXN-2", error: "late" }) });
    expect(res.status).toBe(200);
    expect(db.txns[0].status).toBe("SUCCESS");
    expect(db.txns[0].errorMessage).toBeNull();
    expect(db.txns[0].bbpsTxnId).toBe("TXN-1");
  });

  it("never overwrites REFUNDED", async () => {
    await send({ event: "bill_payment_refunded", ...base() });
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-9" }) });
    await send({ event: "bill_payment_failure", ...base({ txnId: "TXN-10" }) });
    expect(db.txns[0].status).toBe("REFUNDED");
  });

  it("moves SUCCESS → REFUNDED", async () => {
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    await send({ event: "bill_payment_refunded", ...base({ txnId: "TXN-1" }) });
    expect(db.txns).toHaveLength(1);
    expect(db.txns[0].status).toBe("REFUNDED");
  });

  it("lets bill_payment_success win over an earlier collection failure", async () => {
    await send({ event: "bill_collection_failure", ...base() });
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    expect(db.txns[0].status).toBe("SUCCESS");
    expect(db.txns[0].errorCode).toBeNull();
  });

  it("falls back on refId when orderId is missing, then adopts the orderId", async () => {
    const { orderId: _drop, ...noOrder } = base();
    await send({ event: "bill_collection_failure", ...noOrder });
    expect(db.txns[0].setuOrderId).toBeNull();
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    expect(db.txns).toHaveLength(1);
    expect(db.txns[0].setuOrderId).toBe("ORD-1");
    expect(db.txns[0].status).toBe("SUCCESS");
  });

  it("keeps a second payment attempt for the same refId on its own row", async () => {
    await send({ event: "bill_collection_failure", ...base({ orderId: "ORD-A" }) });
    await send({ event: "bill_payment_success", ...base({ orderId: "ORD-B", txnId: "TXN-B" }) });
    expect(db.txns.map((t) => [t.setuOrderId, t.status])).toEqual([
      ["ORD-A", "FAILED"],
      ["ORD-B", "SUCCESS"],
    ]);
  });

  it("re-processes a stored event that failed earlier (500 then 200)", async () => {
    const body = { event: "bill_payment_success", ...base({ txnId: "TXN-1" }) };
    const spy = vi.spyOn(fakePrisma.prisma.bbpsTransaction, "create").mockRejectedValueOnce(new Error("db down"));
    const first = await send(body);
    expect(first.status).toBe(500);
    expect(db.events[0].processedAt).toBeNull();
    expect(db.events[0].error).toContain("db down");
    spy.mockRestore();

    const retry = await send(body);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ status: "acknowledged" });
    expect(db.events).toHaveLength(1);
    expect(db.events[0].processedAt).toBeInstanceOf(Date);
    expect(db.events[0].error).toBeNull();
    expect(db.txns[0].status).toBe("SUCCESS");
  });
});

describe("fetch, dispute and unknown events", () => {
  it("logs fetch events without a transaction row", async () => {
    const res = await send({ event: "bill_fetch_success", ...base() });
    expect(res.status).toBe(200);
    expect(db.events).toHaveLength(1);
    expect(db.txns).toHaveLength(0);
  });

  it("stores unknown events and returns 200", async () => {
    const res = await send({ event: "something_new", foo: "bar" });
    expect(res.status).toBe(200);
    expect(db.events[0].event).toBe("something_new");
    expect(db.txns).toHaveLength(0);
  });

  it("updates dispute fields on the transaction matched by txnId", async () => {
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    await send({ event: "dispute_raised", txnId: "TXN-1", referenceId: "DSP-1", status: "OPEN", issueType: "Amount deducted" });
    expect(db.txns[0].disputeRefId).toBe("DSP-1");
    expect(db.txns[0].disputeStatus).toBe("OPEN");

    await send({ event: "dispute_status_change", txnId: "TXN-1", referenceId: "DSP-1", status: "IN_PROGRESS" });
    expect(db.txns[0].disputeStatus).toBe("IN_PROGRESS");
    await send({ event: "dispute_status_change", txnId: "TXN-1", referenceId: "DSP-1", status: "RESOLVED" });
    expect(db.txns[0].disputeStatus).toBe("RESOLVED");
    expect(db.txns[0].status).toBe("SUCCESS");
  });

  it("does not let a late dispute_raised overwrite a newer dispute status", async () => {
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    await send({ event: "dispute_status_change", txnId: "TXN-1", referenceId: "DSP-1", status: "RESOLVED" });
    await send({ event: "dispute_raised", txnId: "TXN-1", referenceId: "DSP-1", status: "OPEN" });
    expect(db.txns[0].disputeStatus).toBe("RESOLVED");
  });
});

describe("CI Points hook", () => {
  it("does nothing when BBPS_REWARDS_ENABLED is off", async () => {
    process.env.BBPS_REWARD_POINTS_PER_100 = "10";
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    await send({ event: "bill_payment_refunded", ...base({ txnId: "TXN-1" }) });
    expect(db.txns[0].status).toBe("REFUNDED");
    expect(walletService.creditPoints).not.toHaveBeenCalled();
    expect(walletService.debitPoints).not.toHaveBeenCalled();
  });

  it("credits on success and reverses on refund when enabled", async () => {
    process.env.BBPS_REWARDS_ENABLED = "true";
    process.env.BBPS_REWARD_POINTS_PER_100 = "10";
    await send({ event: "bill_payment_success", ...base({ txnId: "TXN-1" }) });
    expect(walletService.creditPoints).toHaveBeenCalledWith(
      USER_ID,
      60,
      "EARN_BBPS",
      expect.objectContaining({ idempotencyKey: "EARN_BBPS:ORD-1" })
    );

    await send({ event: "bill_payment_refunded", ...base({ txnId: "TXN-1" }) });
    expect(db.txns[0].status).toBe("REFUNDED");
    expect(walletService.debitPoints).toHaveBeenCalledWith(
      USER_ID,
      60,
      "DEBIT_BBPS",
      expect.objectContaining({ idempotencyKey: "DEBIT_BBPS:ORD-1" })
    );
    expect(db.ledger.map((l) => l.pointsDelta)).toEqual([60, -60]);
  });

  it("does not credit an unknown user or a late success after a refund", async () => {
    process.env.BBPS_REWARDS_ENABLED = "true";
    process.env.BBPS_REWARD_POINTS_PER_100 = "10";
    await send({ event: "bill_payment_success", ...base({ orderId: "ORD-X", customerId: "nobody" }) });
    await send({ event: "bill_payment_refunded", ...base({ orderId: "ORD-Y" }) });
    await send({ event: "bill_payment_success", ...base({ orderId: "ORD-Y", txnId: "TXN-Y" }) });
    expect(walletService.creditPoints).not.toHaveBeenCalled();
    expect(walletService.debitPoints).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("parses amounts to 2-decimal Decimals", () => {
    expect(parseAmount("601.00")?.toFixed(2)).toBe("601.00");
    expect(parseAmount("1,234.5")?.toFixed(2)).toBe("1234.50");
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("parses paidOn as IST and rejects junk", () => {
    expect(parsePaidOn("01-01-2026 00:00:00")?.toISOString()).toBe("2025-12-31T18:30:00.000Z");
    expect(parsePaidOn("31-02-2026 10:00:00")).toBeNull();
    expect(parsePaidOn("2026-11-05T10:00:00Z")).toBeNull();
    expect(parsePaidOn(undefined)).toBeNull();
  });

  it("only moves status forward", () => {
    expect(canTransition("PENDING", "SUCCESS", "bill_payment_success")).toBe(true);
    expect(canTransition("SUCCESS", "FAILED", "bill_payment_failure")).toBe(false);
    expect(canTransition("SUCCESS", "REFUNDED", "bill_payment_refunded")).toBe(true);
    expect(canTransition("REFUNDED", "SUCCESS", "bill_payment_success")).toBe(false);
    expect(canTransition("FAILED", "SUCCESS", "bill_payment_success")).toBe(true);
  });

  it("builds the dedupe key from the first available id", () => {
    expect(buildDedupeKey({ event: "bill_payment_success", txnId: "T", orderId: "O" })).toBe("bill_payment_success:T");
    expect(buildDedupeKey({ event: "bill_payment_failure", orderId: "O", refId: "R" })).toBe("bill_payment_failure:O");
    expect(buildDedupeKey({ event: "dispute_raised", referenceId: "D", refId: "R" })).toBe("dispute_raised:D");
    expect(buildDedupeKey({ event: "dispute_status_change", txnId: "T", status: "RESOLVED" })).toBe(
      "dispute_status_change:T:RESOLVED"
    );
  });
});
