/**
 * billpayWebhook.service.ts — Setu BillPay (pre-built screens) webhook processing. Spec 002.
 *
 * Flow per delivery:
 *   1. Insert a BbpsWebhookEvent row (dedupeKey unique). A unique violation means Setu is
 *      re-delivering: if the stored event was processed → "duplicate", nothing else happens;
 *      if it was stored but never processed (processedAt null, e.g. the earlier attempt threw)
 *      → process it again. Processing is idempotent, so this is safe.
 *   2. Apply the event (payment → BbpsTransaction upsert with forward-only status,
 *      dispute → dispute fields, fetch / unknown → log only).
 *   3. Mark the event processed. If step 2 throws, the error is recorded on the event and
 *      re-thrown so the controller answers 500 and Setu retries (up to 5 times).
 *
 * Keying of BbpsTransaction rows:
 *   - `orderId` (Setu order) is the primary key → `setuOrderId` (unique).
 *   - Without `orderId`, fall back on `refId` (most recent row with that refId).
 *   - With `orderId` but no row for it yet, a row that has the same `refId` and no
 *     `setuOrderId` is adopted (an earlier orderId-less event for the same payment).
 *   `refId` is deliberately NOT unique: one fetched bill (one refId) can be paid in more
 *   than one attempt (a failed UPI collection, then a retry), each with its own orderId.
 *
 * Status is forward-only (see `canTransition`).
 */

import crypto from "crypto";
import { Prisma, WalletTxType } from "../generated/prisma/client";
import type { BbpsTransaction } from "../generated/prisma/client";
import { prisma } from "../config/prisma";
import { walletService } from "./wallet.service";
import { RewardsCalcService } from "./rewardsCalc.service";

export const BbpsTxnStatus = {
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type BbpsTxnStatus = (typeof BbpsTxnStatus)[keyof typeof BbpsTxnStatus];

// ── Config (read lazily from env; wired into src/config/env.ts separately) ────────────

export function getBillpayWebhookApiKey(): string | undefined {
  const key = process.env.SETU_BILLPAY_WEBHOOK_API_KEY?.trim();
  return key ? key : undefined;
}

export function getBbpsRewardsConfig(): { enabled: boolean; pointsPer100: number } {
  const enabled = (process.env.BBPS_REWARDS_ENABLED || "").trim().toLowerCase() === "true";
  const raw = Number(process.env.BBPS_REWARD_POINTS_PER_100 ?? 0);
  const pointsPer100 = Number.isFinite(raw) && raw > 0 ? raw : 0;
  return { enabled, pointsPer100 };
}

/**
 * Constant-time check of the `X-BILL-WEBHOOK-API-KEY` header. Both sides are hashed first so
 * timingSafeEqual gets equal-length buffers and the key length isn't leaked.
 * No key configured → always false (no open bypass in any environment).
 */
export function verifyBillpayWebhookApiKey(provided: unknown): boolean {
  const expected = getBillpayWebhookApiKey();
  if (!expected) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

// ── Event table ───────────────────────────────────────────────────────────────────────

export const FETCH_EVENTS = new Set(["bill_fetch_success", "bill_fetch_failure"]);

export const PAYMENT_EVENT_STATUS: Record<string, BbpsTxnStatus> = {
  bill_collection_failure: BbpsTxnStatus.FAILED,
  bill_payment_success: BbpsTxnStatus.SUCCESS,
  bill_payment_failure: BbpsTxnStatus.FAILED,
  bill_payment_refunded: BbpsTxnStatus.REFUNDED,
};

export const DISPUTE_EVENTS = new Set(["dispute_raised", "dispute_status_change"]);

export type BillpayWebhookPayload = Record<string, unknown> & { event: string };

export interface BillpayWebhookResult {
  status: "acknowledged" | "duplicate";
}

// ── Parsing helpers (Setu sends every value as a string) ─────────────────────────────

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const DECIMAL_10_2_MAX = new Prisma.Decimal("99999999.99");

/** "601.00" → Decimal(601.00). Anything unparsable, negative or too large for Decimal(10,2) → null. */
export function parseAmount(v: unknown): Prisma.Decimal | null {
  const s = str(v)?.replace(/,/g, "");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const d = new Prisma.Decimal(s).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return d.greaterThan(DECIMAL_10_2_MAX) ? null : d;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** "05-11-2026 14:03:27" (DD-MM-YYYY HH:mm[:ss], IST) → Date. Unparsable → null. */
export function parsePaidOn(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [day, month, year, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const asUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Reject overflowing dates such as 31-02-2026
  if (asUtc.getUTCFullYear() !== year || asUtc.getUTCMonth() !== month - 1 || asUtc.getUTCDate() !== day) {
    return null;
  }
  return new Date(asUtc.getTime() - IST_OFFSET_MS);
}

/** `error` may arrive as a plain string, a JSON string or an object. */
export function parseSetuError(v: unknown): { code: string | null; message: string | null } {
  if (v == null || v === "") return { code: null, message: null };
  let value: unknown = v;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      value = JSON.parse(v);
    } catch {
      value = v;
    }
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return {
      code: str(o.code) ?? str(o.errorCode),
      message: str(o.message) ?? str(o.reason) ?? str(o.errorMessage) ?? str(o.description),
    };
  }
  return { code: null, message: str(value) };
}

export function buildDedupeKey(payload: Record<string, unknown>): string {
  const event = str(payload.event) ?? "unknown";
  const id =
    str(payload.txnId) ??
    str(payload.orderId) ??
    str(payload.referenceId) ??
    str(payload.refId) ??
    str(payload.sessionId);
  // A dispute moves through several statuses with the same ids, so each status change is
  // its own event; everything else is one delivery per event per id.
  const status = event === "dispute_status_change" ? str(payload.status) : null;
  if (id) return status ? `${event}:${id}:${status}` : `${event}:${id}`;
  // No identifier at all — fall back on the payload content so exact re-deliveries still dedupe.
  const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `${event}:sha256:${hash}`;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "P2002";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Status rules ──────────────────────────────────────────────────────────────────────

/**
 * Forward-only status machine:
 *   PENDING  → SUCCESS | FAILED | REFUNDED
 *   FAILED   → REFUNDED, or → SUCCESS only on `bill_payment_success` (Setu's word that the
 *              biller was paid is authoritative; a collection/payment failure for the same
 *              order can be delivered before or out of order with it)
 *   SUCCESS  → REFUNDED (never downgraded to FAILED by a late failure event)
 *   REFUNDED → nothing (final)
 */
export function canTransition(from: string, to: BbpsTxnStatus, event: string): boolean {
  if (from === to) return false;
  switch (from) {
    case BbpsTxnStatus.PENDING:
    case "INITIATED":
    case "VALIDATING":
    case "BILL_FETCHED":
    case "PAYMENT_PROCESSING":
      return true;
    case BbpsTxnStatus.FAILED:
      return to === BbpsTxnStatus.REFUNDED || (to === BbpsTxnStatus.SUCCESS && event === "bill_payment_success");
    case BbpsTxnStatus.SUCCESS:
      return to === BbpsTxnStatus.REFUNDED;
    default:
      return false;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────────────

export async function handleBillpayWebhook(payload: BillpayWebhookPayload): Promise<BillpayWebhookResult> {
  const event = payload.event;
  const dedupeKey = buildDedupeKey(payload);
  const jsonPayload = payload as unknown as Prisma.InputJsonValue;

  let eventId: string;
  try {
    const row = await prisma.bbpsWebhookEvent.create({
      data: { event, dedupeKey, payload: jsonPayload },
    });
    eventId = row.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.bbpsWebhookEvent.findUnique({ where: { dedupeKey } });
    if (!existing) throw err;
    if (existing.processedAt) return { status: "duplicate" };
    // Stored by an earlier delivery that failed to process — process it again.
    eventId = existing.id;
  }

  try {
    await applyEvent(event, payload);
    await prisma.bbpsWebhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), error: null },
    });
  } catch (err) {
    await prisma.bbpsWebhookEvent
      .update({ where: { id: eventId }, data: { error: errorText(err).slice(0, 2000) } })
      .catch(() => undefined);
    throw err;
  }

  return { status: "acknowledged" };
}

async function applyEvent(event: string, p: Record<string, unknown>): Promise<void> {
  if (FETCH_EVENTS.has(event)) return; // analytics only: the event row is the record
  const target = PAYMENT_EVENT_STATUS[event];
  if (target) return applyPaymentEvent(event, target, p);
  if (DISPUTE_EVENTS.has(event)) return applyDisputeEvent(event, p);
  console.warn(`[BillPay webhook] Unknown event "${event}" stored without processing`);
}

// ── Payment events ────────────────────────────────────────────────────────────────────

async function resolveUserId(customerId: unknown): Promise<string | null> {
  const id = str(customerId);
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  return user?.id ?? null;
}

async function findTransaction(orderId: string | null, refId: string | null): Promise<BbpsTransaction | null> {
  if (orderId) {
    const byOrder = await prisma.bbpsTransaction.findUnique({ where: { setuOrderId: orderId } });
    if (byOrder) return byOrder;
  }
  if (refId) {
    return prisma.bbpsTransaction.findFirst({
      where: orderId ? { refId, setuOrderId: null } : { refId },
      orderBy: { createdAt: "desc" },
    });
  }
  return null;
}

type TxnFields = {
  bbpsTxnId: string | null;
  refId: string | null;
  sessionId: string | null;
  mobileNumber: string | null;
  billerId: string | null;
  billerName: string | null;
  category: string | null;
  billAmount: Prisma.Decimal | null;
  amountPaid: Prisma.Decimal | null;
  paidOn: Date | null;
};

function extractFields(p: Record<string, unknown>): TxnFields {
  return {
    bbpsTxnId: str(p.txnId),
    refId: str(p.refId),
    sessionId: str(p.sessionId),
    mobileNumber: str(p.mobileNumber),
    billerId: str(p.billerId),
    billerName: str(p.billerName),
    category: str(p.billerCategory),
    billAmount: parseAmount(p.billAmount),
    amountPaid: parseAmount(p.amountPaid),
    paidOn: parsePaidOn(p.paidOn),
  };
}

const MAX_WRITE_ATTEMPTS = 3;

async function applyPaymentEvent(event: string, target: BbpsTxnStatus, p: Record<string, unknown>): Promise<void> {
  const orderId = str(p.orderId);
  const refId = str(p.refId);
  if (!orderId && !refId) {
    console.warn(`[BillPay webhook] ${event} has neither orderId nor refId — no transaction row written`);
    return;
  }

  const fields = extractFields(p);
  const userId = await resolveUserId(p.customerId);
  const err = parseSetuError(p.error);
  const errorData =
    target === BbpsTxnStatus.SUCCESS
      ? { errorCode: null, errorMessage: null }
      : { errorCode: err.code, errorMessage: err.message };
  const rawPayload = p as Prisma.InputJsonValue;

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const existing = await findTransaction(orderId, refId);

    if (!existing) {
      try {
        const created = await prisma.bbpsTransaction.create({
          data: {
            internalTxnId: orderId ? `CKK-WH-${orderId}` : `CKK-WH-${crypto.randomUUID()}`,
            refID: orderId ? `WH-${orderId}` : `WH-${crypto.randomUUID()}`,
            refId: fields.refId,
            setuOrderId: orderId,
            bbpsTxnId: fields.bbpsTxnId,
            sessionId: fields.sessionId,
            mobileNumber: fields.mobileNumber,
            billerId: fields.billerId ?? "UNKNOWN",
            billerName: fields.billerName ?? "Bill Payment",
            category: fields.category ?? "UTILITY",
            amount: fields.amountPaid ?? fields.billAmount ?? new Prisma.Decimal(0),
            billAmount: fields.billAmount,
            amountPaid: fields.amountPaid,
            paidOn: fields.paidOn,
            userId,
            status: target,
            ...errorData,
            rawPayload,
          },
        });
        await applyRewards(event, created);
        return;
      } catch (e) {
        if (isUniqueViolation(e)) continue; // a concurrent delivery created it — re-read
        throw e;
      }
    }

    const transition = canTransition(existing.status, target, event);
    const data: Prisma.BbpsTransactionUncheckedUpdateManyInput = {};
    // Identity/detail fields: a status-changing event overwrites with what it carries;
    // any other (late / stale) event only fills gaps.
    for (const [key, value] of Object.entries(fields) as [keyof TxnFields, unknown][]) {
      if (value == null) continue;
      if (transition || existing[key] == null) (data as Record<string, unknown>)[key] = value;
    }
    if (orderId && !existing.setuOrderId) data.setuOrderId = orderId;
    if (userId && !existing.userId) data.userId = userId;
    if (transition) {
      Object.assign(data, { status: target, ...errorData, rawPayload });
    } else {
      console.info(
        `[BillPay webhook] ${event} ignored for status: ${existing.status} → ${target} not allowed (txn ${existing.id})`
      );
    }

    if (Object.keys(data).length > 0) {
      // Optimistic guard: only write if nobody changed the status since we read it.
      const res = await prisma.bbpsTransaction.updateMany({
        where: { id: existing.id, status: existing.status },
        data,
      });
      if (res.count === 0) continue;
    }

    await applyRewards(event, { ...existing, ...(data as Partial<BbpsTransaction>) });
    return;
  }

  throw new Error(`BbpsTransaction write conflict for ${orderId ?? refId} after ${MAX_WRITE_ATTEMPTS} attempts`);
}

// ── CI Points hook ────────────────────────────────────────────────────────────────────

/**
 * Runs on every (re)processing of a success/refund event, based on the row's resulting
 * status rather than on "did the status just change", so a retry after a failed wallet
 * write still credits. Wallet idempotency keys make repeats no-ops.
 *   - bill_payment_success & row SUCCESS → credit (only when BBPS_REWARDS_ENABLED=true)
 *   - bill_payment_refunded & row REFUNDED → reverse exactly what EARN_BBPS:<orderId>
 *     credited, if anything (independent of the flag, so turning the flag off later
 *     doesn't leave earned points on a refunded bill).
 */
async function applyRewards(event: string, txn: Pick<BbpsTransaction, "status" | "userId" | "setuOrderId" | "amountPaid" | "billAmount" | "billerName">): Promise<void> {
  if (!txn.userId || !txn.setuOrderId) return;

  if (event === "bill_payment_success" && txn.status === BbpsTxnStatus.SUCCESS) {
    const rawAmount = txn.amountPaid ?? txn.billAmount;
    if (!rawAmount) return;
    const billAmount = Number(rawAmount);
    if (!Number.isFinite(billAmount) || billAmount <= 0) return;

    // Calculate Cikka Pay rewards based on authoritative 11-slab matrix
    const reward = RewardsCalcService.calculateCikkaPayRewards(txn.setuOrderId, billAmount);

    // 1. Credit CI Points
    if (reward.ciPointsEarned > 0) {
      await walletService.creditPoints(txn.userId, reward.ciPointsEarned, WalletTxType.EARN_BBPS, {
        idempotencyKey: `EARN_BBPS_PTS:${txn.setuOrderId}`,
        description: `CI Points for bill payment${txn.billerName ? ` to ${txn.billerName}` : ""} (order ${txn.setuOrderId})`,
      });
    }

    // 2. Credit Cashback (in paise)
    if (reward.cashbackEarned > 0) {
      await walletService.creditCash(txn.userId, reward.cashbackEarned * 100, WalletTxType.EARN_CASHBACK, {
        idempotencyKey: `EARN_BBPS_CASH:${txn.setuOrderId}`,
        description: `₹${reward.cashbackEarned} Cashback for bill payment${txn.billerName ? ` to ${txn.billerName}` : ""} (order ${txn.setuOrderId})`,
      });
    }
    return;
  }

  if (event === "bill_payment_refunded" && txn.status === BbpsTxnStatus.REFUNDED) {
    // 1. Reversal for CI Points (checking both new and legacy idempotency keys)
    const earnedPoints =
      (await prisma.loyaltyLedger.findUnique({ where: { idempotencyKey: `EARN_BBPS_PTS:${txn.setuOrderId}` } })) ||
      (await prisma.loyaltyLedger.findUnique({ where: { idempotencyKey: `EARN_BBPS:${txn.setuOrderId}` } }));

    if (earnedPoints && earnedPoints.pointsDelta > 0) {
      try {
        await walletService.debitPoints(earnedPoints.userId, earnedPoints.pointsDelta, WalletTxType.DEBIT_BBPS, {
          idempotencyKey: `DEBIT_BBPS_PTS:${txn.setuOrderId}`,
          description: `CI Points reversed: bill payment refunded (order ${txn.setuOrderId})`,
        });
      } catch (e) {
        if (/Insufficient CI Points/i.test(errorText(e))) {
          console.warn(`[BillPay webhook] Could not reverse BBPS points for order ${txn.setuOrderId}: ${errorText(e)}`);
        } else {
          throw e;
        }
      }
    }

    // 2. Reversal for Cashback
    const earnedCash = await prisma.loyaltyLedger.findUnique({
      where: { idempotencyKey: `EARN_BBPS_CASH:${txn.setuOrderId}` },
    });

    if (earnedCash && earnedCash.cashPaiseDelta > 0) {
      try {
        await walletService.debitCash(earnedCash.userId, earnedCash.cashPaiseDelta, WalletTxType.DEBIT_BBPS, {
          idempotencyKey: `DEBIT_BBPS_CASH:${txn.setuOrderId}`,
          description: `Cashback reversed: bill payment refunded (order ${txn.setuOrderId})`,
        });
      } catch (e) {
        if (/Insufficient cash balance/i.test(errorText(e))) {
          console.warn(`[BillPay webhook] Could not reverse BBPS cashback for order ${txn.setuOrderId}: ${errorText(e)}`);
        } else {
          throw e;
        }
      }
    }
  }
}

// ── Dispute events ────────────────────────────────────────────────────────────────────

async function applyDisputeEvent(event: string, p: Record<string, unknown>): Promise<void> {
  const txnId = str(p.txnId);
  if (!txnId) {
    console.warn(`[BillPay webhook] ${event} without txnId — stored only`);
    return;
  }
  const txn = await prisma.bbpsTransaction.findFirst({
    where: { bbpsTxnId: txnId },
    orderBy: { createdAt: "desc" },
  });
  if (!txn) {
    console.warn(`[BillPay webhook] ${event} for unknown txnId ${txnId} — stored only`);
    return;
  }

  const referenceId = str(p.referenceId);
  const status = str(p.status) ?? (event === "dispute_raised" ? "RAISED" : null);
  const data: Prisma.BbpsTransactionUncheckedUpdateInput = {};
  if (referenceId) data.disputeRefId = referenceId;
  // A late `dispute_raised` must not overwrite a status set by `dispute_status_change`.
  if (status && (event === "dispute_status_change" || !txn.disputeStatus)) data.disputeStatus = status;
  if (Object.keys(data).length === 0) return;

  await prisma.bbpsTransaction.update({ where: { id: txn.id }, data });
}
