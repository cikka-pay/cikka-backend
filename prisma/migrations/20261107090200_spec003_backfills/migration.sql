-- Spec 003 data backfills.

-- 1. Settlements whose transfer was reversed / failed stop being PENDING (payable).
UPDATE "settlements" SET "status" = 'REVERSED'
WHERE "transferStatus" = 'REVERSED' AND "status" = 'PENDING';
UPDATE "settlements" SET "status" = 'FAILED'
WHERE "transferStatus" = 'FAILED' AND "status" = 'PENDING' AND "razorpayTransferId" IS NOT NULL;

-- 2. Link existing mall orders to the user recorded on their Razorpay checkout
--    (order number = Razorpay order id, or "<id>-<n>" for multi-item carts).
UPDATE "orders" o SET "userId" = c."userId"
FROM "razorpay_checkouts" c
WHERE o."userId" IS NULL
  AND c."userId" IS NOT NULL
  AND (o."orderNumber" = c."razorpayOrderId" OR o."orderNumber" LIKE c."razorpayOrderId" || '-%')
  AND EXISTS (SELECT 1 FROM "users" u WHERE u."id" = c."userId");

-- 3. users.ciPoints / cashbackBalance become mirrors of the ledger wallet. The old default
--    (100000) was never earned; users without a wallet have 0.
UPDATE "users" u SET "ciPoints" = COALESCE(w."ciPoints", 0),
                     "cashbackBalance" = COALESCE(w."cashPaise", 0) / 100.0
FROM "users" u2 LEFT JOIN "user_wallets" w ON w."userId" = u2."id"
WHERE u2."id" = u."id";
