-- Idempotent full schema synchronization migration for Railway PostgreSQL.
-- Bridges schema.prisma additions that were previously applied via `prisma db push`
-- so `prisma migrate deploy` in Dockerfile brings production databases fully in sync.

-- ============================================================
-- 1. Enums
-- ============================================================

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'EXCHANGE';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'CASHBACK_REDEEM';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoucherStatus') THEN
    CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED');
  END IF;
END $$;

-- ============================================================
-- 2. Existing Table Column Additions
-- ============================================================

-- sellers
ALTER TABLE "sellers"
  ADD COLUMN IF NOT EXISTS "razorpayAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "razorpayAccountStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "warningCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "isSpecialSeller" BOOLEAN NOT NULL DEFAULT false;

-- seller_onboarding
ALTER TABLE "seller_onboarding"
  ADD COLUMN IF NOT EXISTS "missingDocuments" JSONB,
  ADD COLUMN IF NOT EXISTS "verificationNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "razorpayAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "razorpayAccountStatus" TEXT;

-- products
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "brandName" TEXT,
  ADD COLUMN IF NOT EXISTS "gstSlab" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;

-- orders
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "orders_userId_idx" ON "orders"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_userId_fkey') THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- settlements (ensure full deterministic ledger + transfer tracking + backward-compat fields)
ALTER TABLE "settlements"
  ADD COLUMN IF NOT EXISTS "basePrice" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "gstOnSale" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "gstOnCommission" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "commissionTotal" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "shippingFee" DECIMAL(10,2) DEFAULT 55.00,
  ADD COLUMN IF NOT EXISTS "shippingGst" DECIMAL(10,2) DEFAULT 9.90,
  ADD COLUMN IF NOT EXISTS "shippingTotal" DECIMAL(10,2) DEFAULT 64.90,
  ADD COLUMN IF NOT EXISTS "sellerPlatformFee" DECIMAL(10,2) DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS "sellerPlatformFeeGst" DECIMAL(10,2) DEFAULT 2.70,
  ADD COLUMN IF NOT EXISTS "sellerPlatformTotal" DECIMAL(10,2) DEFAULT 17.70,
  ADD COLUMN IF NOT EXISTS "tdsAmount" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "tcsAmount" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "statutoryTaxes" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "successFeeAmount" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "successFeeGst" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "successFeeTotal" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "customerPlatformFee" DECIMAL(10,2) DEFAULT 9.99,
  ADD COLUMN IF NOT EXISTS "customerPlatformFeeGst" DECIMAL(10,2) DEFAULT 1.80,
  ADD COLUMN IF NOT EXISTS "customerPlatformTotal" DECIMAL(10,2) DEFAULT 11.79,
  ADD COLUMN IF NOT EXISTS "customerTotalPayment" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "cikkaFeeRevenue" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "cikkaGstCollected" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "totalDeductions" DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "ledgerBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "orderId" TEXT,
  ADD COLUMN IF NOT EXISTS "orderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "razorpayTransferId" TEXT,
  ADD COLUMN IF NOT EXISTS "razorpayPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "decentroTxnId" TEXT,
  ADD COLUMN IF NOT EXISTS "holdUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "transferStatus" TEXT DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "utr" TEXT,
  ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "disbursedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "settlements_razorpayTransferId_key" ON "settlements"("razorpayTransferId");
CREATE INDEX IF NOT EXISTS "settlements_orderId_idx" ON "settlements"("orderId");
CREATE INDEX IF NOT EXISTS "settlements_orderNumber_idx" ON "settlements"("orderNumber");
CREATE INDEX IF NOT EXISTS "settlements_razorpayTransferId_idx" ON "settlements"("razorpayTransferId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_orderId_fkey') THEN
    ALTER TABLE "settlements"
      ADD CONSTRAINT "settlements_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "panNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "panVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "profilePic" TEXT,
  ADD COLUMN IF NOT EXISTS "ciPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cashbackBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- team_members
ALTER TABLE "team_members"
  ADD COLUMN IF NOT EXISTS "canViewFinancials" BOOLEAN NOT NULL DEFAULT false;

-- bbps_transactions: no changes here. Its shape is owned by
-- 20261105150000_setu_billpay_webhooks (spec 002, Setu BillPay pre-built screens).

-- bbps_billers
ALTER TABLE "bbps_billers"
  ADD COLUMN IF NOT EXISTS "productInstanceId" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentInstruments" JSONB,
  ADD COLUMN IF NOT EXISTS "fetchRequirement" TEXT,
  ADD COLUMN IF NOT EXISTS "supportBillValidation" TEXT;

-- cin_verification_records
ALTER TABLE "cin_verification_records"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'INSTANTPAY';

-- ============================================================
-- 3. New Tables
-- ============================================================

-- product_reviews
CREATE TABLE IF NOT EXISTS "product_reviews" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "userId" TEXT,
  "userName" TEXT NOT NULL,
  "userPhone" TEXT,
  "rating" INTEGER NOT NULL DEFAULT 5,
  "title" TEXT,
  "comment" TEXT NOT NULL,
  "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "videoUrl" TEXT,
  "helpfulYes" INTEGER NOT NULL DEFAULT 0,
  "helpfulNo" INTEGER NOT NULL DEFAULT 0,
  "verified" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_reviews_productId_idx" ON "product_reviews"("productId");
CREATE INDEX IF NOT EXISTS "product_reviews_userId_idx" ON "product_reviews"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_productId_fkey') THEN
    ALTER TABLE "product_reviews"
      ADD CONSTRAINT "product_reviews_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_reviews_userId_fkey') THEN
    ALTER TABLE "product_reviews"
      ADD CONSTRAINT "product_reviews_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- user_saved_cards
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
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_saved_cards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_saved_cards_razorpayTokenId_key" ON "user_saved_cards"("razorpayTokenId");
CREATE INDEX IF NOT EXISTS "user_saved_cards_userId_idx" ON "user_saved_cards"("userId");
CREATE INDEX IF NOT EXISTS "user_saved_cards_phone_idx" ON "user_saved_cards"("phone");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_saved_cards_userId_fkey') THEN
    ALTER TABLE "user_saved_cards"
      ADD CONSTRAINT "user_saved_cards_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- user_vouchers
CREATE TABLE IF NOT EXISTS "user_vouchers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderReference" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "brandTitle" TEXT NOT NULL,
  "brandCategory" TEXT,
  "brandLogo" TEXT,
  "cardNumber" TEXT NOT NULL,
  "cardPin" TEXT,
  "denomination" INTEGER NOT NULL,
  "pointsBurned" INTEGER NOT NULL,
  "validTill" TIMESTAMP(3),
  "cardType" TEXT,
  "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
  "redeemedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_vouchers_orderReference_key" ON "user_vouchers"("orderReference");
CREATE INDEX IF NOT EXISTS "user_vouchers_userId_idx" ON "user_vouchers"("userId");
CREATE INDEX IF NOT EXISTS "user_vouchers_userId_status_idx" ON "user_vouchers"("userId", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_vouchers_userId_fkey') THEN
    ALTER TABLE "user_vouchers"
      ADD CONSTRAINT "user_vouchers_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- user_notifications
CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'SYSTEM',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_notifications_userId_read_idx" ON "user_notifications"("userId", "read");
CREATE INDEX IF NOT EXISTS "user_notifications_userId_createdAt_idx" ON "user_notifications"("userId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_notifications_userId_fkey') THEN
    ALTER TABLE "user_notifications"
      ADD CONSTRAINT "user_notifications_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Enum additions for BBPS earn/debit ledger entries
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTxType') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'EARN_BBPS'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'WalletTxType')
    ) THEN
      ALTER TYPE "WalletTxType" ADD VALUE 'EARN_BBPS';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum
      WHERE enumlabel = 'DEBIT_BBPS'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'WalletTxType')
    ) THEN
      ALTER TYPE "WalletTxType" ADD VALUE 'DEBIT_BBPS';
    END IF;
  END IF;
END $$;

-- Orders SLA, customer contact & WhatsApp dispatch columns
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "customerEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "customerPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "pincode" TEXT,
  ADD COLUMN IF NOT EXISTS "packDeadline" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationDeadline" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappNotifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappActionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "whatsappActionTaken" TEXT;

CREATE INDEX IF NOT EXISTS "orders_pincode_idx" ON "orders"("pincode");

-- Setu BillPay webhook & dispute columns on bbps_transactions
ALTER TABLE "bbps_transactions"
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "setuOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "bbpsTxnId" TEXT,
  ADD COLUMN IF NOT EXISTS "refId" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "mobileNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "billAmount" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "amountPaid" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "paidOn" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disputeRefId" TEXT,
  ADD COLUMN IF NOT EXISTS "disputeStatus" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "bbps_transactions_setuOrderId_key" ON "bbps_transactions"("setuOrderId");
CREATE INDEX IF NOT EXISTS "bbps_transactions_refId_idx" ON "bbps_transactions"("refId");
CREATE INDEX IF NOT EXISTS "bbps_transactions_bbpsTxnId_idx" ON "bbps_transactions"("bbpsTxnId");

-- bbps_webhook_events
CREATE TABLE IF NOT EXISTS "bbps_webhook_events" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "error" TEXT,

  CONSTRAINT "bbps_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bbps_webhook_events_dedupeKey_key" ON "bbps_webhook_events"("dedupeKey");
CREATE INDEX IF NOT EXISTS "bbps_webhook_events_event_receivedAt_idx" ON "bbps_webhook_events"("event", "receivedAt");

