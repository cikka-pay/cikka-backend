/**
 * wallet.controller.ts
 *
 * REST endpoints for the user-facing CI Points & cashback wallet.
 * All writes go through walletService which enforces double-entry atomicity.
 */

import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { walletService } from "../services/wallet.service";
import { WalletTxType } from "../generated/prisma/client";
import { z } from "zod";
import { formatCustomerLedgerDescription } from "../utils/ledgerDescription";

const APP_RATING_REWARD_POINTS = 150;

// ── GET /api/wallet/balance ───────────────────────────────────────────────────
/**
 * Returns the authenticated user's authoritative server-side wallet balance.
 * The client MUST use this endpoint — never trust AsyncStorage as source of truth.
 */
export const getWalletBalance = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const [balance, ratingRewardEntry] = await Promise.all([
    walletService.getBalance(userId),
    prisma.loyaltyLedger.findUnique({
      where: { idempotencyKey: `APP_RATING:${userId}` },
      select: { id: true },
    }),
  ]);
  const appRatingClaimed = Boolean(ratingRewardEntry);

  res.status(200).json({
    success: true,
    userId,
    app_rating_claimed: appRatingClaimed,
    balance: {
      ci_points: balance.ciPoints,
      cash_paise: balance.cashPaise,
      cash_rupees: balance.cashRupees,
      lifetime_earned_points: balance.lifetimeEarnedPoints,
      lifetime_redeemed_points: balance.lifetimeRedeemedPoints,
      lifetime_earned_rupees: balance.lifetimeEarnedPaise / 100,
      lifetime_redeemed_rupees: balance.lifetimeRedeemedPaise / 100,
      app_rating_claimed: appRatingClaimed,
    },
  });
});

// ── GET /api/wallet/ledger ────────────────────────────────────────────────────
/**
 * Paginated ledger history for the authenticated user.
 * Query params: ?limit=20&cursor=<ledgerEntryId>
 */
export const getWalletLedger = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const cursor = req.query.cursor as string | undefined;

  const { entries, nextCursor } = await walletService.getLedger(userId, limit, cursor);

  res.status(200).json({
    success: true,
    userId,
    entries: entries.map((e: any) => ({
      id: e.id,
      tx_type: e.txType,
      points_delta: e.pointsDelta,
      cash_paise_delta: e.cashPaiseDelta,
      cash_rupees_delta: e.cashPaiseDelta / 100,
      balance_after_points: e.balanceAfterPoints,
      balance_after_paise: e.balanceAfterPaise,
      balance_after_rupees: e.balanceAfterPaise / 100,
      order_id: e.orderId,
      redemption_id: e.redemptionId,
      description: formatCustomerLedgerDescription(e.description, e.txType),
      expires_at: e.expiresAt,
      created_at: e.createdAt,
    })),
    next_cursor: nextCursor,
  });
});

// ── POST /api/wallet/earn-points ─────────────────────────────────────────────
/**
 * Credit CI Points for an order or event.
 * Requires a server-verified source — callers should supply an orderId or
 * idempotency key so the same purchase cannot be credited twice.
 *
 * Body: { points, tx_type?, order_id?, description?, idempotency_key? }
 */
// Zod v4 dropped nativeEnum — use z.enum with explicit string literals
const EARN_TX_TYPES = [
  "EARN_ORDER",
  "EARN_SIGNUP",
  "EARN_REFERRAL",
  "EARN_CASHBACK",
  "EARN_ADMIN",
] as const;

const EarnPointsSchema = z.object({
  points: z.number().int().positive(),
  tx_type: z.enum(EARN_TX_TYPES).optional().default("EARN_ORDER"),
  order_id: z.string().optional(),
  description: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export const earnPoints = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const parse = EarnPointsSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ success: false, error: parse.error.flatten() });
    return;
  }

  const { points, tx_type, order_id, description, idempotency_key } = parse.data;

  // Build idempotency key automatically if caller didn't supply one
  const idem = idempotency_key ?? (order_id ? `${tx_type}:${order_id}` : undefined);

  const result = await walletService.creditPoints(userId, points, tx_type as WalletTxType, {
    orderId: order_id,
    description,
    idempotencyKey: idem,
  });

  res.status(200).json({
    success: true,
    duplicate: result.duplicate ?? false,
    ledger_entry_id: result.ledgerEntryId,
    balance_after_points: result.balanceAfterPoints,
    balance_after_cash_rupees: result.balanceAfterPaise / 100,
  });
});

// ── POST /api/wallet/earn-cashback ────────────────────────────────────────────
/**
 * Credit ₹5 cashback (or any amount in paise) for an order.
 * Body: { amount_paise, order_id?, description?, idempotency_key? }
 */
const EarnCashbackSchema = z.object({
  amount_paise: z.number().int().positive(),
  order_id: z.string().optional(),
  description: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export const earnCashback = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const parse = EarnCashbackSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ success: false, error: parse.error.flatten() });
    return;
  }

  const { amount_paise, order_id, description, idempotency_key } = parse.data;
  const idem = idempotency_key ?? (order_id ? `EARN_CASHBACK:${order_id}` : undefined);

  const result = await walletService.creditCash(userId, amount_paise, WalletTxType.EARN_CASHBACK, {
    orderId: order_id,
    description: description ?? `₹${(amount_paise / 100).toFixed(2)} cashback`,
    idempotencyKey: idem,
  });

  res.status(200).json({
    success: true,
    duplicate: result.duplicate ?? false,
    ledger_entry_id: result.ledgerEntryId,
    balance_after_points: result.balanceAfterPoints,
    balance_after_cash_rupees: result.balanceAfterPaise / 100,
  });
});

// ── POST /api/wallet/withdraw ────────────────────────────────────────────────
/**
 * Withdraw cashback or CI Points to Cikka Account.
 * Debits the authoritative server-side wallet balance atomically with double-entry.
 * Body: { type: "cashback" | "points", amount: number, description?: string }
 */
const WithdrawSchema = z.object({
  type: z.enum(["cashback", "points"]),
  amount: z.number().positive(),
  description: z.string().optional(),
  // Required: a client-generated key (e.g. a UUID per withdrawal attempt) so retries never debit twice
  idempotency_key: z.string().min(8).max(128),
});

export const withdrawFunds = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const parse = WithdrawSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ success: false, error: parse.error.flatten() });
    return;
  }

  const { type, amount, description, idempotency_key } = parse.data;

  // Safeguard limits
  if (type === "cashback" && amount > 25000) {
    res.status(400).json({ success: false, error: "Maximum single withdrawal limit for cashback is ₹25,000" });
    return;
  }
  if (type === "points" && amount > 100000) {
    res.status(400).json({ success: false, error: "Maximum single withdrawal limit for CI Points is 100,000 pts" });
    return;
  }

  const idem = `WITHDRAW:${userId}:${idempotency_key}`;

  try {
    if (type === "cashback") {
      const amountPaise = Math.round(amount * 100);
      const result = await walletService.debitCash(
        userId,
        amountPaise,
        WalletTxType.CASHBACK_REDEEM,
        {
          idempotencyKey: idem,
          description: formatCustomerLedgerDescription(description, WalletTxType.CASHBACK_REDEEM) || "Cashback Withdrawal",
        }
      );
      res.status(200).json({
        success: true,
        type: "cashback",
        withdrawn_rupees: amount,
        balance_after_cash_rupees: result.balanceAfterPaise / 100,
        balance_after_points: result.balanceAfterPoints,
      });
    } else {
      const points = Math.round(amount);
      const result = await walletService.debitPoints(
        userId,
        points,
        WalletTxType.REDEEM_REWARD,
        {
          idempotencyKey: idem,
          description: formatCustomerLedgerDescription(description, WalletTxType.REDEEM_REWARD) || "CI Points Redemption",
        }
      );
      res.status(200).json({
        success: true,
        type: "points",
        withdrawn_points: points,
        balance_after_points: result.balanceAfterPoints,
        balance_after_cash_rupees: result.balanceAfterPaise / 100,
      });
    }
  } catch (err: any) {
    res.status(422).json({
      success: false,
      error: err.message || "Withdrawal failed",
    });
  }
});

const rateAppSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  feedback: z.string().trim().max(500).optional(),
});

// ── POST /api/wallet/rate-app-reward ─────────────────────────────────────────
/**
 * Idempotently credits 150 CI Points to the user's Rewards Wallet when they rate Cikka.
 */
export const rateAppReward = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  const parsed = rateAppSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid rating payload",
    });
    return;
  }

  const rating = parsed.data.rating ?? 5;
  const feedback = parsed.data.feedback;

  const result = await walletService.creditPoints(
    userId,
    APP_RATING_REWARD_POINTS,
    WalletTxType.EARN_ADMIN,
    {
      idempotencyKey: `APP_RATING:${userId}`,
      description: "Rate Cikka & Earn 150 CI Points",
      notificationMeta: {
        category: "rewards",
        title: "+150 CI Points Credited!",
        body: "Thanks for rating Cikka — 150 CI Points have been credited to your Rewards Wallet.",
        screen: "wallet",
        params: { tab: "points" },
        actionLabel: "Open Wallet",
        extra: {
          source: "APP_RATING",
          rating,
          ...(feedback ? { feedback } : {}),
        },
      },
    }
  );

  res.status(200).json({
    success: true,
    alreadyClaimed: Boolean(result.duplicate),
    app_rating_claimed: true,
    pointsAwarded: result.duplicate ? 0 : APP_RATING_REWARD_POINTS,
    balance_after_points: result.balanceAfterPoints,
    balance_after_cash_rupees: result.balanceAfterPaise / 100,
    ledgerEntryId: result.ledgerEntryId,
  });
});
