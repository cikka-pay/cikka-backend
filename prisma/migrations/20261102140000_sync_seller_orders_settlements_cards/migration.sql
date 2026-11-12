-- ============================================================
-- Migration: sync_seller_orders_settlements_cards
-- Sync schema drift:
-- 1. OrderStatus enum: add 'EXCHANGE'
-- 2. sellers: add warningCount, isSuspended, suspendedAt, suspensionReason, isSpecialSeller
-- 3. orders: add deliveredAt
-- 4. settlements: add orderId, orderNumber, decentroTxnId and foreign keys
-- 5. users: add ciPoints, cashbackBalance
-- 6. user_saved_cards: create table and indexes
-- ============================================================

-- 1. Add EXCHANGE to OrderStatus enum if missing
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'EXCHANGE';

-- 2. Sellers SLA strikes, suspension & special seller flags
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "warningCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT;
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "isSpecialSeller" BOOLEAN NOT NULL DEFAULT false;

-- 3. Orders delivery tracking timestamp for T+7 hold release
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- 4. Settlements order linkage & backward-compatible decentroTxnId
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "orderId" TEXT;
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "orderNumber" TEXT;
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "decentroTxnId" TEXT;

CREATE INDEX IF NOT EXISTS "settlements_orderId_idx" ON "settlements"("orderId");
CREATE INDEX IF NOT EXISTS "settlements_orderNumber_idx" ON "settlements"("orderNumber");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_orderId_fkey') THEN
    ALTER TABLE "settlements" ADD CONSTRAINT "settlements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. Users vault balances (CI Points & Cashback)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ciPoints" INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cashbackBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- 6. User saved cards table for Razorpay customer vault tokens
CREATE TABLE IF NOT EXISTS "user_saved_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT,
    "razorpayCustomerId" TEXT,
    "razorpayTokenId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "cardNetwork" TEXT NOT NULL,
    "cardType" TEXT NOT NULL DEFAULT 'credit',
    "last4" TEXT NOT NULL,
    "cardholderName" TEXT,
    "expiryMonth" TEXT,
    "expiryYear" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_saved_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_saved_cards_razorpayTokenId_key" ON "user_saved_cards"("razorpayTokenId");
CREATE INDEX IF NOT EXISTS "user_saved_cards_userId_idx" ON "user_saved_cards"("userId");
CREATE INDEX IF NOT EXISTS "user_saved_cards_phone_idx" ON "user_saved_cards"("phone");
CREATE INDEX IF NOT EXISTS "user_saved_cards_razorpayTokenId_idx" ON "user_saved_cards"("razorpayTokenId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_saved_cards_userId_fkey') THEN
    ALTER TABLE "user_saved_cards" ADD CONSTRAINT "user_saved_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
