-- Spec 003 §9: saved cards are Razorpay customer tokens. Rows created by the old
-- POST /cards/save carried made-up `token_hq_*` ids that Razorpay has never issued; they can
-- never be charged, so retire them (the cache is refreshed from Razorpay on GET /cards/saved).
UPDATE "user_saved_cards" SET "status" = 'REVOKED', "isDefault" = false
WHERE "razorpayTokenId" LIKE 'token_hq_%' AND "status" <> 'REVOKED';
