-- Schema drift fix: Product.pendingPrice / pendingMrp / priceRequestedAt are in schema.prisma
-- (seller price-change approval) but no migration ever created them, so every Product query
-- fails with ColumnNotFound on a database built from migrations. IF NOT EXISTS keeps this safe
-- on databases where the columns were added out of band (e.g. prisma db push).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pendingMrp" DECIMAL(10,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pendingPrice" DECIMAL(10,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "priceRequestedAt" TIMESTAMP(3);
