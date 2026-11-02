-- ============================================================
-- Migration: add_wallet_and_loyalty_ledger
-- Adds UserWallet (authoritative balance) and LoyaltyLedger
-- (append-only double-entry journal) for server-side CI Points
-- and ₹5 cashback accounting.
-- ============================================================

-- 1. WalletTxType enum
CREATE TYPE "WalletTxType" AS ENUM (
  'EARN_ORDER',
  'EARN_SIGNUP',
  'EARN_REFERRAL',
  'EARN_CASHBACK',
  'EARN_ADMIN',
  'REDEEM_REWARD',
  'DEBIT_EXPIRY',
  'DEBIT_REFUND',
  'DEBIT_ADMIN',
  'CASHBACK_REDEEM'
);

-- 2. user_wallets — one row per user, authoritative balance
CREATE TABLE "user_wallets" (
  "id"                      TEXT NOT NULL,
  "userId"                  TEXT NOT NULL,
  "ciPoints"                INTEGER NOT NULL DEFAULT 0,
  "cashPaise"               INTEGER NOT NULL DEFAULT 0,
  "lifetimeEarnedPoints"    INTEGER NOT NULL DEFAULT 0,
  "lifetimeRedeemedPoints"  INTEGER NOT NULL DEFAULT 0,
  "lifetimeEarnedPaise"     INTEGER NOT NULL DEFAULT 0,
  "lifetimeRedeemedPaise"   INTEGER NOT NULL DEFAULT 0,
  "version"                 INTEGER NOT NULL DEFAULT 0,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("id")
);

-- 3. loyalty_ledger — append-only journal
CREATE TABLE "loyalty_ledger" (
  "id"                  TEXT NOT NULL,
  "userId"              TEXT NOT NULL,
  "txType"              "WalletTxType" NOT NULL,
  "pointsDelta"         INTEGER NOT NULL DEFAULT 0,
  "cashPaiseDelta"      INTEGER NOT NULL DEFAULT 0,
  "balanceAfterPoints"  INTEGER NOT NULL,
  "balanceAfterPaise"   INTEGER NOT NULL,
  "orderId"             TEXT,
  "redemptionId"        TEXT,
  "razorpayPaymentId"   TEXT,
  "description"         TEXT,
  "idempotencyKey"      TEXT,
  "expiresAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);

-- 4. Unique constraints
CREATE UNIQUE INDEX "user_wallets_userId_key"        ON "user_wallets"("userId");
CREATE UNIQUE INDEX "loyalty_ledger_idempotencyKey_key" ON "loyalty_ledger"("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- 5. Lookup indexes on loyalty_ledger
CREATE INDEX "loyalty_ledger_userId_createdAt_idx" ON "loyalty_ledger"("userId", "createdAt");
CREATE INDEX "loyalty_ledger_userId_txType_idx"    ON "loyalty_ledger"("userId", "txType");
CREATE INDEX "loyalty_ledger_orderId_idx"           ON "loyalty_ledger"("orderId");
CREATE INDEX "loyalty_ledger_redemptionId_idx"      ON "loyalty_ledger"("redemptionId");

-- 6. Foreign keys (CASCADE delete so orphan rows can't exist)
ALTER TABLE "user_wallets"
  ADD CONSTRAINT "user_wallets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loyalty_ledger"
  ADD CONSTRAINT "loyalty_ledger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
