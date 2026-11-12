import "dotenv/config";
import { prisma } from "../src/config/prisma";

async function patch() {
  console.log("Starting safe database patch...");

  try {
    // 1. Sellers table missing columns (Return SLA & Strike System)
    console.log("Adding missing columns to sellers table...");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "sellers" 
        ADD COLUMN IF NOT EXISTS "warningCount" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT,
        ADD COLUMN IF NOT EXISTS "isSpecialSeller" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log("✓ sellers table updated successfully.");

    // 2. bbps_transactions: intentionally not patched here — its shape is owned by the
    //    20261105150000_setu_billpay_webhooks migration (spec 002).

    // 3. BBPS Billers table missing columns
    console.log("Adding missing columns to bbps_billers table...");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "bbps_billers"
        ADD COLUMN IF NOT EXISTS "productInstanceId" TEXT,
        ADD COLUMN IF NOT EXISTS "description" TEXT,
        ADD COLUMN IF NOT EXISTS "paymentInstruments" JSONB,
        ADD COLUMN IF NOT EXISTS "fetchRequirement" TEXT,
        ADD COLUMN IF NOT EXISTS "supportBillValidation" TEXT;
    `);
    console.log("✓ bbps_billers table updated successfully.");

    // 7. Add userId to orders table if not exists
    console.log("Adding userId to orders table...");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "userId" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'orders_userId_idx'
        ) THEN
          CREATE INDEX "orders_userId_idx" ON "orders"("userId");
        END IF;
      END $$;
    `);
    console.log("✓ orders table updated with userId.");

    // 8. Create user_notifications table if not exists
    console.log("Creating user_notifications table if not exists...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "user_notifications" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'rewards',
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "read" BOOLEAN NOT NULL DEFAULT false,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "user_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'user_notifications' AND indexname = 'user_notifications_userId_read_idx'
        ) THEN
          CREATE INDEX "user_notifications_userId_read_idx" ON "user_notifications"("userId", "read");
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'user_notifications' AND indexname = 'user_notifications_userId_createdAt_idx'
        ) THEN
          CREATE INDEX "user_notifications_userId_createdAt_idx" ON "user_notifications"("userId", "createdAt");
        END IF;
      END $$;
    `);
    console.log("✓ user_notifications table checked.");

    // 8b. Add missing columns to users table
    console.log("Adding missing columns to users table if not exist...");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "ciPoints" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "cashbackBalance" DECIMAL(10, 2) NOT NULL DEFAULT 0.00;
    `);
    console.log("✓ users table checked.");

    // 9. Create WalletTxType enum, user_wallets and loyalty_ledger tables
    console.log("Creating user_wallets and loyalty_ledger tables if not exist...");
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTxType') THEN
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
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "user_wallets" (
        "id"                      TEXT NOT NULL PRIMARY KEY,
        "userId"                  TEXT NOT NULL,
        "ciPoints"                INTEGER NOT NULL DEFAULT 0,
        "cashPaise"               INTEGER NOT NULL DEFAULT 0,
        "lifetimeEarnedPoints"    INTEGER NOT NULL DEFAULT 0,
        "lifetimeRedeemedPoints"  INTEGER NOT NULL DEFAULT 0,
        "lifetimeEarnedPaise"     INTEGER NOT NULL DEFAULT 0,
        "lifetimeRedeemedPaise"   INTEGER NOT NULL DEFAULT 0,
        "version"                 INTEGER NOT NULL DEFAULT 0,
        "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'user_wallets' AND indexname = 'user_wallets_userId_key'
        ) THEN
          CREATE UNIQUE INDEX "user_wallets_userId_key" ON "user_wallets"("userId");
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'user_wallets_userId_fkey'
        ) THEN
          ALTER TABLE "user_wallets"
            ADD CONSTRAINT "user_wallets_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "loyalty_ledger" (
        "id"                  TEXT NOT NULL PRIMARY KEY,
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
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'loyalty_ledger' AND indexname = 'loyalty_ledger_idempotencyKey_key'
        ) THEN
          CREATE UNIQUE INDEX "loyalty_ledger_idempotencyKey_key" ON "loyalty_ledger"("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'loyalty_ledger' AND indexname = 'loyalty_ledger_userId_createdAt_idx'
        ) THEN
          CREATE INDEX "loyalty_ledger_userId_createdAt_idx" ON "loyalty_ledger"("userId", "createdAt");
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'loyalty_ledger' AND indexname = 'loyalty_ledger_userId_txType_idx'
        ) THEN
          CREATE INDEX "loyalty_ledger_userId_txType_idx" ON "loyalty_ledger"("userId", "txType");
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'loyalty_ledger' AND indexname = 'loyalty_ledger_orderId_idx'
        ) THEN
          CREATE INDEX "loyalty_ledger_orderId_idx" ON "loyalty_ledger"("orderId");
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE tablename = 'loyalty_ledger' AND indexname = 'loyalty_ledger_redemptionId_idx'
        ) THEN
          CREATE INDEX "loyalty_ledger_redemptionId_idx" ON "loyalty_ledger"("redemptionId");
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_ledger_userId_fkey'
        ) THEN
          ALTER TABLE "loyalty_ledger"
            ADD CONSTRAINT "loyalty_ledger_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    console.log("✓ user_wallets and loyalty_ledger tables checked.");

    console.log("\n🎉 Database patch completed successfully without any data loss!");
  } catch (err) {
    console.error("Patch error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

patch();
