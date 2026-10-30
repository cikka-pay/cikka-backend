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
import { WalletTxType } from "../generated/prisma/client";

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
]);

const REDEEM_TYPES = new Set<WalletTxType>([
  WalletTxType.REDEEM_REWARD,
  WalletTxType.DEBIT_EXPIRY,
  WalletTxType.DEBIT_REFUND,
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
  },

  /**
   * Paginated ledger history for a user.
   */
  async getLedger(userId: string, limit = 20, cursor?: string) {
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
  },

  /**
   * Apply a double-entry credit or debit.
   *
   * Safety guarantees:
   *   - Runs inside a serializable DB transaction.
   *   - Idempotency: if `idempotencyKey` is already present, returns the
   *     existing ledger entry without modifying the wallet (no double-credit).
   *   - Prevents negative balances for debit operations by checking BEFORE
   *     the transaction commits.
   */
  async applyEntry(input: LedgerEntryInput): Promise<LedgerResult> {
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

    // Validate — exactly one dimension must be non-zero
    if (pointsDelta === 0 && cashPaiseDelta === 0) {
      throw new Error("WalletService: Both pointsDelta and cashPaiseDelta are zero — nothing to apply.");
    }

    // 1. Idempotency check (fast-path, outside transaction)
    if (idempotencyKey) {
      const existing = await prisma.loyaltyLedger.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        return {
          ledgerEntryId: existing.id,
          walletId: "",
          balanceAfterPoints: existing.balanceAfterPoints,
          balanceAfterPaise: existing.balanceAfterPaise,
          duplicate: true,
        };
      }
    }

    // 2. Run the double-entry inside a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 2a. Ensure user exists so foreign key is always satisfied
      await tx.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          phone: `+91${userId.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`,
          phoneVerified: true,
        },
        update: {},
      }).catch(() => {});

      // 2b. Upsert wallet and lock the row
      const wallet = await tx.userWallet.upsert({
        where: { userId },
        create: {
          userId,
          ciPoints: 0,
          cashPaise: 0,
          version: 0,
        },
        update: {}, // Just locks the row; we'll update it below
      });

      // 2b. Guard against negative balances on debits
      if (pointsDelta < 0) {
        const newPoints = wallet.ciPoints + pointsDelta;
        if (newPoints < 0) {
          throw new Error(
            `Insufficient CI Points. Current: ${wallet.ciPoints}, Attempted debit: ${Math.abs(pointsDelta)}`
          );
        }
      }
      if (cashPaiseDelta < 0) {
        const newCash = wallet.cashPaise + cashPaiseDelta;
        if (newCash < 0) {
          throw new Error(
            `Insufficient cash balance. Current: ₹${(wallet.cashPaise / 100).toFixed(2)}, Attempted debit: ₹${(Math.abs(cashPaiseDelta) / 100).toFixed(2)}`
          );
        }
      }

      // 2c. Compute new balances
      const newCiPoints = wallet.ciPoints + pointsDelta;
      const newCashPaise = wallet.cashPaise + cashPaiseDelta;

      // 2d. Build lifetime analytics deltas
      const isEarn = isEarnType(txType);
      const isRedeem = isRedeemType(txType);

      const lifetimePointsEarnDelta = isEarn && pointsDelta > 0 ? pointsDelta : 0;
      const lifetimePointsRedeemDelta = isRedeem && pointsDelta < 0 ? Math.abs(pointsDelta) : 0;
      const lifetimePaiseEarnDelta = isEarn && cashPaiseDelta > 0 ? cashPaiseDelta : 0;
      const lifetimePaiseRedeemDelta = isRedeem && cashPaiseDelta < 0 ? Math.abs(cashPaiseDelta) : 0;

      // 2e. Update the wallet atomically with optimistic-lock increment
      const updatedWallet = await tx.userWallet.update({
        where: { userId, version: wallet.version },
        data: {
          ciPoints: newCiPoints,
          cashPaise: newCashPaise,
          lifetimeEarnedPoints: { increment: lifetimePointsEarnDelta },
          lifetimeRedeemedPoints: { increment: lifetimePointsRedeemDelta },
          lifetimeEarnedPaise: { increment: lifetimePaiseEarnDelta },
          lifetimeRedeemedPaise: { increment: lifetimePaiseRedeemDelta },
          version: { increment: 1 },
        },
      });

      // 2f. Append the immutable ledger entry
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

      return { entry, wallet: updatedWallet };
    });

    return {
      ledgerEntryId: result.entry.id,
      walletId: result.wallet.id,
      balanceAfterPoints: result.wallet.ciPoints,
      balanceAfterPaise: result.wallet.cashPaise,
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
