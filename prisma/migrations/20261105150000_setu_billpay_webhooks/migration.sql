-- ============================================================
-- Migration: setu_billpay_webhooks (spec 002)
-- 1. WalletTxType: add EARN_BBPS, DEBIT_BBPS (CI Points on bill pay, behind a flag)
-- 2. BbpsTxnStatus enum
-- 3. bbps_transactions: reshape to Setu BillPay pre-built-screen ids
--    (setuOrderId unique, bbpsTxnId, refId, sessionId, …). Old columns from the
--    retired direct-pay flow (refID, setuBillId, setuPaymentId, bbpsRefNo,
--    customerParams, amount) are dropped; existing rows keep their refID as refId,
--    amount as amountPaid and a mapped status.
-- 4. bbps_webhook_events: append-only webhook log with a unique dedupe key
-- Generated with `prisma migrate diff`, then edited to carry existing rows over.
-- ============================================================

-- 1. WalletTxType
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'EARN_BBPS';
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'DEBIT_BBPS';

-- 2. BbpsTxnStatus
CREATE TYPE "BbpsTxnStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- 3. bbps_transactions
DROP INDEX IF EXISTS "bbps_transactions_refID_key";
DROP INDEX IF EXISTS "bbps_transactions_refID_idx";
DROP INDEX IF EXISTS "bbps_transactions_userId_idx";
DROP INDEX IF EXISTS "bbps_transactions_category_idx";

ALTER TABLE "bbps_transactions"
ADD COLUMN "setuOrderId" TEXT,
ADD COLUMN "bbpsTxnId" TEXT,
ADD COLUMN "refId" TEXT,
ADD COLUMN "sessionId" TEXT,
ADD COLUMN "mobileNumber" TEXT,
ADD COLUMN "billAmount" DECIMAL(10,2),
ADD COLUMN "amountPaid" DECIMAL(10,2),
ADD COLUMN "paidOn" TIMESTAMP(3),
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "disputeRefId" TEXT,
ADD COLUMN "disputeStatus" TEXT,
ADD COLUMN "status_new" "BbpsTxnStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "billerId" DROP NOT NULL,
ALTER COLUMN "billerName" DROP NOT NULL,
ALTER COLUMN "category" DROP NOT NULL;

-- Carry existing rows over (only sandbox/stub data from the retired flow is expected)
UPDATE "bbps_transactions"
SET "refId"      = "refID",
    "amountPaid" = "amount",
    "status_new" = CASE UPPER("status")
                     WHEN 'SUCCESS'  THEN 'SUCCESS'::"BbpsTxnStatus"
                     WHEN 'FAILED'   THEN 'FAILED'::"BbpsTxnStatus"
                     WHEN 'FAILURE'  THEN 'FAILED'::"BbpsTxnStatus"
                     WHEN 'REFUNDED' THEN 'REFUNDED'::"BbpsTxnStatus"
                     ELSE 'PENDING'::"BbpsTxnStatus"
                   END;

ALTER TABLE "bbps_transactions"
DROP COLUMN "refID",
DROP COLUMN "amount",
DROP COLUMN "setuBillId",
DROP COLUMN "setuPaymentId",
DROP COLUMN "bbpsRefNo",
DROP COLUMN "customerParams",
DROP COLUMN "status";

ALTER TABLE "bbps_transactions" RENAME COLUMN "status_new" TO "status";

CREATE UNIQUE INDEX "bbps_transactions_setuOrderId_key" ON "bbps_transactions"("setuOrderId");
CREATE INDEX "bbps_transactions_userId_createdAt_idx" ON "bbps_transactions"("userId", "createdAt");
CREATE INDEX "bbps_transactions_refId_idx" ON "bbps_transactions"("refId");
CREATE INDEX "bbps_transactions_bbpsTxnId_idx" ON "bbps_transactions"("bbpsTxnId");
CREATE INDEX "bbps_transactions_status_idx" ON "bbps_transactions"("status");

-- userId was free text before; clear values that don't point at a user so the FK can be added
UPDATE "bbps_transactions" t
SET "userId" = NULL
WHERE t."userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = t."userId");

ALTER TABLE "bbps_transactions"
ADD CONSTRAINT "bbps_transactions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. bbps_webhook_events
CREATE TABLE "bbps_webhook_events" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "bbps_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bbps_webhook_events_dedupeKey_key" ON "bbps_webhook_events"("dedupeKey");
CREATE INDEX "bbps_webhook_events_event_receivedAt_idx" ON "bbps_webhook_events"("event", "receivedAt");
