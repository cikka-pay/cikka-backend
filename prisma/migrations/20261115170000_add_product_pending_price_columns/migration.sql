-- Schema drift fix: these columns were declared in prisma/schema.prisma
-- (seller price-change requests awaiting admin approval) but no migration
-- ever created them, so any query selecting full `products` rows failed with
-- P2022 ColumnNotFound (e.g. GET /api/mall/products).
-- All statements are additive / idempotent and do not touch existing data.

-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pendingMrp" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "pendingPrice" DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS "priceRequestedAt" TIMESTAMP(3);

-- `updatedAt` is @updatedAt (set by Prisma Client) in the schema, but the
-- creating migrations gave it a DB default. Align with the schema; existing
-- rows are unchanged.
-- AlterTable
ALTER TABLE "user_saved_cards" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_wallets" ALTER COLUMN "updatedAt" DROP DEFAULT;
