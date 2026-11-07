/**
 * wallet.service.ts
 *
 * Double-entry server-side wallet for CI Points & ₹5 cashback.
 * ALL balance mutations happen inside a single Prisma transaction:
 *   1. Upsert UserWallet (optimistic-lock via `version`)
 *   2. Insert LoyaltyLedger row with idempotencyKey
 * This guarantees atomicity and prevents duplicate credits/debits.
 */

import { prisma } from "../config/prisma";
import { Prisma, WalletTxType } from "../generated/prisma/client";

/** Interactive-transaction client (prisma.$transaction callback argument). */
export type Tx = Prisma.TransactionClient;

/** A debit that would take a balance below zero. */
export class InsufficientBalanceError extends Error {
  constructor(public balance: "POINTS" | "CASH", message: string) {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

function duplicateResult(existing: { id: string; balanceAfterPoints: number; balanceAfterPaise: number }): LedgerResult {
  return {
    ledgerEntryId: existing.id,
    walletId: "",
    balanceAfterPoints: existing.balanceAfterPoints,
    balanceAfterPaise: existing.balanceAfterPaise,
    duplicate: true,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletBalance {
  ciPoints: number;
  cashPaise: number;
  cashRupees: number;
  lifetimeEarnedPoints: number;
  lifetimeRedeemedPoints: number;
  lifetimeEarnedPaise: number;
  lifetimeRedeemedPaise: number;
  walletId: string;
}

export interface LedgerEntryInput {
  userId: string;
  txType: WalletTxType;
  /** Positive = credit, Negative = debit. Exactly one of pointsDelta or cashPaiseDelta must be non-zero. */
  pointsDelta?: number;
  cashPaiseDelta?: number;
  idempotencyKey?: string;   // Caller-supplied; format: `<txType>:<sourceId>`
  orderId?: string;
  redemptionId?: string;
  razorpayPaymentId?: string;
  description?: string;
  expiresAt?: Date;
}

export interface LedgerResult {
  ledgerEntryId: string;
  walletId: string;
  balanceAfterPoints: number;
  balanceAfterPaise: number;
  /** Already-exists — returned only when idempotency key was already present */
  duplicate?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EARN_TYPES = new Set<WalletTxType>([
  WalletTxType.EARN_ORDER,
  WalletTxType.EARN_SIGNUP,
  WalletTxType.EARN_REFERRAL,
  WalletTxType.EARN_CASHBACK,
  WalletTxType.EARN_ADMIN,
  WalletTxType.EARN_BBPS,
]);

const REDEEM_TYPES = new Set<WalletTxType>([
  WalletTxType.REDEEM_REWARD,
  WalletTxType.DEBIT_EXPIRY,
  WalletTxType.DEBIT_REFUND,
  WalletTxType.DEBIT_BBPS,
  WalletTxType.DEBIT_ADMIN,
  WalletTxType.CASHBACK_REDEEM,
]);

function isEarnType(txType: WalletTxType): boolean {
  return EARN_TYPES.has(txType);
}

function isRedeemType(txType: WalletTxType): boolean {
  return REDEEM_TYPES.has(txType);
}

// ── Core Service ─────────────────────────────────────────────────────────────

export const walletService = {
  /**
   * Get the authoritative wallet balance for a user.
   * Returns zeros if the wallet has not been initialised yet.
   */
  async getBalance(userId: string): Promise<WalletBalance> {
    try {
      const wallet = await prisma.userWallet.findUnique({ where: { userId } });
      if (!wallet) {
        return {
          ciPoints: 0,
          cashPaise: 0,
          cashRupees: 0,
          lifetimeEarnedPoints: 0,
          lifetimeRedeemedPoints: 0,
          lifetimeEarnedPaise: 0,
          lifetimeRedeemedPaise: 0,
          walletId: "",
        };
      }
      return {
        ciPoints: wallet.ciPoints,
        cashPaise: wallet.cashPaise,
        cashRupees: wallet.cashPaise / 100,
        lifetimeEarnedPoints: wallet.lifetimeEarnedPoints,
        lifetimeRedeemedPoints: wallet.lifetimeRedeemedPoints,
        lifetimeEarnedPaise: wallet.lifetimeEarnedPaise,
        lifetimeRedeemedPaise: wallet.lifetimeRedeemedPaise,
        walletId: wallet.id,
      };
    } catch (err: any) {
      console.warn(`[WalletService Warning] getBalance fallback: ${err.message}`);
      return {
        ciPoints: 0,
        cashPaise: 0,
        cashRupees: 0,
        lifetimeEarnedPoints: 0,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
        walletId: "",
      };
    }
  },

  /**
   * Paginated ledger history for a user.
   */
  async getLedger(userId: string, limit = 20, cursor?: string) {
    try {
      const entries = await prisma.loyaltyLedger.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | null = null;
      if (entries.length > limit) {
        const nextItem = entries.pop();
        nextCursor = nextItem?.id ?? null;
      }

      return { entries, nextCursor };
    } catch (err: any) {
      console.warn(`[WalletService Warning] getLedger fallback: ${err.message}`);
      return { entries: [], nextCursor: null };
    }
  },

  /**
   * Apply a double-entry credit or debit.
   *
   * Safety guarantees:
   *   - Runs inside a DB transaction with the wallet row locked (SELECT … FOR UPDATE).
   *   - Mirrors the new balance onto User.ciPoints / User.cashbackBalance (deprecated).
   *   - Idempotency: if `idempotencyKey` is already present, returns the
   *     existing ledger entry without modifying the wallet (no double-credit).
   *   - Prevents negative balances for debit operations by checking BEFORE
   *     the transaction commits.
   */
  async applyEntry(input: LedgerEntryInput): Promise<LedgerResult> {
    // Idempotency fast path, outside the transaction
    if (input.idempotencyKey) {
      const existing = await prisma.loyaltyLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return duplicateResult(existing);
    }
    return prisma.$transaction((tx) => this.applyEntryTx(tx, input));
  },

  /**
   * Apply a ledger entry inside a caller's transaction (e.g. mall/rewards fulfilment, so the
   * points/cash debit commits or rolls back together with the order rows).
   * Throws InsufficientBalanceError when a debit would go negative.
   */
  async applyEntryTx(tx: Tx, input: LedgerEntryInput): Promise<LedgerResult> {
    const {
      userId,
      txType,
      pointsDelta = 0,
      cashPaiseDelta = 0,
      idempotencyKey,
      orderId,
      redemptionId,
      razorpayPaymentId,
      description,
      expiresAt,
    } = input;

    if (pointsDelta === 0 && cashPaiseDelta === 0) {
      throw new Error("WalletService: Both pointsDelta and cashPaiseDelta are zero — nothing to apply.");
    }
    if (!Number.isInteger(pointsDelta) || !Number.isInteger(cashPaiseDelta)) {
      throw new Error("WalletService: deltas must be integers (points, paise).");
    }

    if (idempotencyKey) {
      const existing = await tx.loyaltyLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return duplicateResult(existing);
    }

    // The user must exist: balances belong to real accounts only (no placeholder users).
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new Error(`WalletService: user ${userId} not found`);

    // Row lock on the wallet so concurrent debits serialise (SELECT … FOR UPDATE).
    await tx.userWallet.upsert({
      where: { userId },
      create: { userId, ciPoints: 0, cashPaise: 0, version: 0 },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "user_wallets" WHERE "userId" = ${userId} FOR UPDATE`;
    const wallet = await tx.userWallet.findUniqueOrThrow({ where: { userId } });

    const newCiPoints = wallet.ciPoints + pointsDelta;
    const newCashPaise = wallet.cashPaise + cashPaiseDelta;
    if (pointsDelta < 0 && newCiPoints < 0) {
      throw new InsufficientBalanceError(
        "POINTS",
        `Insufficient CI Points. Current: ${wallet.ciPoints}, Attempted debit: ${Math.abs(pointsDelta)}`
      );
    }
    if (cashPaiseDelta < 0 && newCashPaise < 0) {
      throw new InsufficientBalanceError(
        "CASH",
        `Insufficient cash balance. Current: ₹${(wallet.cashPaise / 100).toFixed(2)}, Attempted debit: ₹${(Math.abs(cashPaiseDelta) / 100).toFixed(2)}`
      );
    }

    const isEarn = isEarnType(txType);
    const isRedeem = isRedeemType(txType);

    const updatedWallet = await tx.userWallet.update({
      where: { userId },
      data: {
        ciPoints: newCiPoints,
        cashPaise: newCashPaise,
        lifetimeEarnedPoints: { increment: isEarn && pointsDelta > 0 ? pointsDelta : 0 },
        lifetimeRedeemedPoints: { increment: isRedeem && pointsDelta < 0 ? -pointsDelta : 0 },
        lifetimeEarnedPaise: { increment: isEarn && cashPaiseDelta > 0 ? cashPaiseDelta : 0 },
        lifetimeRedeemedPaise: { increment: isRedeem && cashPaiseDelta < 0 ? -cashPaiseDelta : 0 },
        version: { increment: 1 },
      },
    });

    // Keep the deprecated User mirrors in step with the ledger (same transaction).
    await tx.user.update({
      where: { id: userId },
      data: { ciPoints: newCiPoints, cashbackBalance: (newCashPaise / 100).toFixed(2) },
    });

    const entry = await tx.loyaltyLedger.create({
      data: {
        userId,
        txType,
        pointsDelta,
        cashPaiseDelta,
        balanceAfterPoints: newCiPoints,
        balanceAfterPaise: newCashPaise,
        orderId,
        redemptionId,
        razorpayPaymentId,
        description,
        idempotencyKey,
        expiresAt,
      },
    });

    return {
      ledgerEntryId: entry.id,
      walletId: updatedWallet.id,
      balanceAfterPoints: updatedWallet.ciPoints,
      balanceAfterPaise: updatedWallet.cashPaise,
    };
  },

  /**
   * Credit CI Points (convenience wrapper around applyEntry).
   */
  async creditPoints(
    userId: string,
    points: number,
    txType: WalletTxType,
    opts?: Omit<LedgerEntryInput, "userId" | "txType" | "pointsDelta">
  ): Promise<LedgerResult> {
    if (points <= 0) throw new Error("creditPoints: points must be > 0");
    return this.applyEntry({ userId, txType, pointsDelta: points, ...opts });
  },

  /**
   * Debit CI Points (convenience wrapper — amount should be positive,
   * the wrapper negates it internally).
   */
  async debitPoints(
    userId: string,
    points: number,
    txType: WalletTxType,
    opts?: Omit<LedgerEntryInput, "userId" | "txType" | "pointsDelta">
  ): Promise<LedgerResult> {
    if (points <= 0) throw new Error("debitPoints: points must be > 0");
    return this.applyEntry({ userId, txType, pointsDelta: -points, ...opts });
  },

  /**
   * Credit cash (in paise).
   */
  async creditCash(
    userId: string,
    amountPaise: number,
    txType: WalletTxType,
    opts?: Omit<LedgerEntryInput, "userId" | "txType" | "cashPaiseDelta">
  ): Promise<LedgerResult> {
    if (amountPaise <= 0) throw new Error("creditCash: amountPaise must be > 0");
    return this.applyEntry({ userId, txType, cashPaiseDelta: amountPaise, ...opts });
  },

  /**
   * Debit cash (in paise, pass positive amount).
   */
  async debitCash(
    userId: string,
    amountPaise: number,
    txType: WalletTxType,
    opts?: Omit<LedgerEntryInput, "userId" | "txType" | "cashPaiseDelta">
  ): Promise<LedgerResult> {
    if (amountPaise <= 0) throw new Error("debitCash: amountPaise must be > 0");
    return this.applyEntry({ userId, txType, cashPaiseDelta: -amountPaise, ...opts });
  },
};
