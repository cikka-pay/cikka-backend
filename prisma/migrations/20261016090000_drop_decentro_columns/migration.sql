-- Decentro payouts were replaced by Razorpay Route; drop the unused columns.
-- DropIndex
DROP INDEX IF EXISTS "settlements_decentroTxnId_key";

-- DropIndex
DROP INDEX IF EXISTS "settlements_decentroTxnId_idx";

-- AlterTable
ALTER TABLE "settlements" DROP COLUMN IF EXISTS "decentroTxnId",
DROP COLUMN IF EXISTS "decentroUrn";
