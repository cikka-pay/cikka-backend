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

    // 2. BBPS Transactions table missing columns
    console.log("Adding missing columns to bbps_transactions table...");
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "bbps_transactions"
        ADD COLUMN IF NOT EXISTS "internalTxnId" TEXT,
        ADD COLUMN IF NOT EXISTS "platformBillId" TEXT,
        ADD COLUMN IF NOT EXISTS "paymentInstrument" TEXT DEFAULT 'UPI',
        ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT,
        ADD COLUMN IF NOT EXISTS "receiptDate" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
        ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
        ADD COLUMN IF NOT EXISTS "settlementRef" TEXT;
    `);
    // Backfill internalTxnId for any existing rows if null
    await prisma.$executeRawUnsafe(`
      UPDATE "bbps_transactions" 
      SET "internalTxnId" = "refID" 
      WHERE "internalTxnId" IS NULL AND "refID" IS NOT NULL;
    `);
    // Backfill any remaining null internalTxnId with UUID
    await prisma.$executeRawUnsafe(`
      UPDATE "bbps_transactions" 
      SET "internalTxnId" = 'CKK-BBPS-' || id 
      WHERE "internalTxnId" IS NULL;
    `);
    // Create unique constraint on internalTxnId if not exists
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'bbps_transactions_internalTxnId_key'
        ) THEN
          ALTER TABLE "bbps_transactions" ADD CONSTRAINT "bbps_transactions_internalTxnId_key" UNIQUE ("internalTxnId");
        END IF;
      END $$;
    `);
    console.log("✓ bbps_transactions table updated successfully.");

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

    // 4. Create bbps_saved_billers table if not exists
    console.log("Creating bbps_saved_billers table if not exists...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "bbps_saved_billers" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "billerId" TEXT NOT NULL,
        "customerParams" JSONB NOT NULL,
        "nickname" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ bbps_saved_billers checked.");

    // 5. Create bbps_bills table if not exists
    console.log("Creating bbps_bills table if not exists...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "bbps_bills" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "platformBillId" TEXT NOT NULL UNIQUE,
        "billerBillId" TEXT,
        "userId" TEXT,
        "billerId" TEXT NOT NULL,
        "customerReference" TEXT,
        "amount" DECIMAL(10, 2) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "dueDate" TIMESTAMP(3),
        "billDate" TIMESTAMP(3),
        "taxes" DECIMAL(10, 2),
        "discounts" DECIMAL(10, 2),
        "fees" DECIMAL(10, 2),
        "items" JSONB,
        "status" TEXT NOT NULL DEFAULT 'UNPAID',
        "rawPayload" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ bbps_bills checked.");

    // 6. Create bbps_settlements table if not exists
    console.log("Creating bbps_settlements table if not exists...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "bbps_settlements" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "settlementReference" TEXT NOT NULL UNIQUE,
        "amount" DECIMAL(10, 2) NOT NULL,
        "utr" TEXT,
        "ifsc" TEXT,
        "instrument" TEXT,
        "transactionDetails" JSONB,
        "reconciliationStatus" TEXT NOT NULL DEFAULT 'PENDING',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ bbps_settlements checked.");

    console.log("\n🎉 Database patch completed successfully without any data loss!");
  } catch (err) {
    console.error("Patch error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

patch();
