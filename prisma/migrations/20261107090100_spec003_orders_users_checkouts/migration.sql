-- Spec 003: orders linked to users, checkout processing lease, Razorpay customer for saved
-- cards, settlement.processed reconciliation id, ciPoints default 0, updatedAt drift.

-- Orders belong to the buyer who paid for them (nullable for historic rows)
ALTER TABLE "orders" ADD COLUMN "userId" TEXT;
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fulfilment lease / recovery
ALTER TABLE "razorpay_checkouts" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "stage" TEXT;

-- Razorpay settlement id of the linked account bank settlement (settlement.processed)
ALTER TABLE "settlements" ADD COLUMN "recipientSettlementId" TEXT;
CREATE INDEX "settlements_recipientSettlementId_idx" ON "settlements"("recipientSettlementId");

-- Saved cards: one Razorpay customer per user
ALTER TABLE "users" ADD COLUMN "razorpayCustomerId" TEXT;
CREATE UNIQUE INDEX "users_razorpayCustomerId_key" ON "users"("razorpayCustomerId");

-- Unknown users no longer start with 100000 CI Points
ALTER TABLE "users" ALTER COLUMN "ciPoints" SET DEFAULT 0;

-- Remaining updatedAt default drift (Prisma manages @updatedAt itself)
ALTER TABLE "user_saved_cards" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "user_wallets" ALTER COLUMN "updatedAt" DROP DEFAULT;
