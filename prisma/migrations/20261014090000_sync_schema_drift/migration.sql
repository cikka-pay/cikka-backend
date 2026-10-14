-- Brings the database in line with prisma/schema.prisma.
-- Earlier schema changes (team members, admin users, commission/agreement configs,
-- user addresses, Razorpay Route and settlement ledger columns) were never captured
-- in a migration, so `prisma migrate deploy` could not create them in production
-- (e.g. "The column `sellers.razorpayAccountId` does not exist").
-- Every statement is idempotent so it is safe on databases that were partly
-- patched by hand (`db push`).

-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- AlterTable
ALTER TABLE "cin_verification_records" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'INSTANTPAY';

-- AlterTable
ALTER TABLE "seller_onboarding" ADD COLUMN IF NOT EXISTS "missingDocuments" JSONB,
ADD COLUMN IF NOT EXISTS "razorpayAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "razorpayAccountStatus" TEXT DEFAULT 'NOT_CREATED',
ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
ADD COLUMN IF NOT EXISTS "verificationNotes" TEXT;

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN IF NOT EXISTS "razorpayAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "razorpayAccountStatus" TEXT DEFAULT 'NOT_CREATED';

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "basePrice" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "cikkaFeeRevenue" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "cikkaGstCollected" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "commissionTotal" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "customerPlatformFee" DECIMAL(10,2) DEFAULT 9.99,
ADD COLUMN IF NOT EXISTS "customerPlatformFeeGst" DECIMAL(10,2) DEFAULT 1.80,
ADD COLUMN IF NOT EXISTS "customerPlatformTotal" DECIMAL(10,2) DEFAULT 11.79,
ADD COLUMN IF NOT EXISTS "customerTotalPayment" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "decentroTxnId" TEXT,
ADD COLUMN IF NOT EXISTS "decentroUrn" TEXT,
ADD COLUMN IF NOT EXISTS "disbursedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
ADD COLUMN IF NOT EXISTS "gstOnCommission" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "gstOnSale" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "holdUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "ledgerBreakdown" JSONB,
ADD COLUMN IF NOT EXISTS "razorpayPaymentId" TEXT,
ADD COLUMN IF NOT EXISTS "razorpayTransferId" TEXT,
ADD COLUMN IF NOT EXISTS "sellerPlatformFee" DECIMAL(10,2) DEFAULT 15.00,
ADD COLUMN IF NOT EXISTS "sellerPlatformFeeGst" DECIMAL(10,2) DEFAULT 2.70,
ADD COLUMN IF NOT EXISTS "sellerPlatformTotal" DECIMAL(10,2) DEFAULT 17.70,
ADD COLUMN IF NOT EXISTS "shippingFee" DECIMAL(10,2) DEFAULT 55.00,
ADD COLUMN IF NOT EXISTS "shippingGst" DECIMAL(10,2) DEFAULT 9.90,
ADD COLUMN IF NOT EXISTS "shippingTotal" DECIMAL(10,2) DEFAULT 64.90,
ADD COLUMN IF NOT EXISTS "statutoryTaxes" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "successFeeAmount" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "successFeeGst" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "successFeeTotal" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "tcsAmount" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "tdsAmount" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "totalDeductions" DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS "transferStatus" TEXT DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "utr" TEXT,
ALTER COLUMN "category" SET DEFAULT 'General',
ALTER COLUMN "commissionRate" SET DEFAULT 22.00,
ALTER COLUMN "shippingGstAmount" SET DEFAULT 0.00;

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "houseNo" TEXT,
    "street" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "pincode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COMPLIANCE_OFFICER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seller_commission_configs" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "flatOrderFee" DECIMAL(10,2) NOT NULL DEFAULT 15.00,
    "categoryCommissions" JSONB NOT NULL,
    "settlementCycle" "SettlementCycle" NOT NULL DEFAULT 'T_PLUS_7',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_commission_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seller_agreement_configs" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "customText" TEXT,
    "customClauses" JSONB,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_agreement_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "team_members" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "phoneOtpCode" TEXT,
    "phoneOtpExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_addresses_userId_idx" ON "user_addresses"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_addresses_pincode_idx" ON "user_addresses"("pincode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seller_commission_configs_sellerId_key" ON "seller_commission_configs"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "seller_agreement_configs_sellerId_key" ON "seller_agreement_configs"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_sellerId_phone_key" ON "team_members"("sellerId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sellers_razorpayAccountId_key" ON "sellers"("razorpayAccountId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "settlements_razorpayTransferId_key" ON "settlements"("razorpayTransferId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "settlements_decentroTxnId_key" ON "settlements"("decentroTxnId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "settlements_razorpayTransferId_idx" ON "settlements"("razorpayTransferId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "settlements_decentroTxnId_idx" ON "settlements"("decentroTxnId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_addresses_userId_fkey') THEN
    ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_commission_configs_sellerId_fkey') THEN
    ALTER TABLE "seller_commission_configs" ADD CONSTRAINT "seller_commission_configs_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_agreement_configs_sellerId_fkey') THEN
    ALTER TABLE "seller_agreement_configs" ADD CONSTRAINT "seller_agreement_configs_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_members_sellerId_fkey') THEN
    ALTER TABLE "team_members" ADD CONSTRAINT "team_members_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
