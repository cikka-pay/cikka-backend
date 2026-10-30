/**
 * wallet.controller.ts
 *
 * REST endpoints for the user-facing CI Points & cashback wallet.
 * All writes go through walletService which enforces double-entry atomicity.
 */

import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { walletService } from "../services/wallet.service";
import { WalletTxType } from "../generated/prisma/client";
import { z } from "zod";

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

  const balance = await walletService.getBalance(userId);
  res.status(200).json({
    success: true,
    userId,
    balance: {
      ci_points: balance.ciPoints,
      cash_paise: balance.cashPaise,
      cash_rupees: balance.cashRupees,
      lifetime_earned_points: balance.lifetimeEarnedPoints,
      lifetime_redeemed_points: balance.lifetimeRedeemedPoints,
      lifetime_earned_rupees: balance.lifetimeEarnedPaise / 100,
      lifetime_redeemed_rupees: balance.lifetimeRedeemedPaise / 100,
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
    entries: entries.map((e) => ({
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
      description: e.description,
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

  const { type, amount, description } = parse.data;

  try {
    if (type === "cashback") {
      const amountPaise = Math.round(amount * 100);
      const result = await walletService.debitCash(
        userId,
        amountPaise,
        WalletTxType.CASHBACK_REDEEM,
        {
          description: description || `Withdrawal of ₹${amount.toFixed(2)} to Cikka Account`,
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
          description: description || `Withdrawal of ${points} CI Points to Cikka Account`,
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
