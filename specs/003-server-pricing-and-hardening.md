# Spec 003 — Server-side mall pricing and payments hardening

## Goal

The mobile app computed mall prices, discounts and the order total, and the backend trusted
the item prices it was sent. Those prices drive seller settlements and Route payouts. This
spec moves all money math to the server and closes the issues left open by the Razorpay
audit (PR #31): orders not linked to users, wrong seller, `settlement.processed`, reversed
settlements counted as payable, rewards balances, stuck checkouts, CORS, fake saved-card
tokens, exchange after payment, schema drift and the 401-for-unknown-paths catch-all.

Docs relied on (razorpay.com/docs/build/llm-docs/…):
`webhooks/route.md` (settlement.processed sample payload),
`api/payments/route/fetch-transfers-for-a-settlement.md`,
`api/payments/route/fetch-transfers-payment.md`,
`payments/payment-methods/cards/features/integrate-saved-cards.md`,
`payments/payment-gateway/web-integration/custom/features/saved-cards/scenario-2.md`
(customer tokens list / delete), `api/customers/create.md`.

## 1. What the app shows today (and what the server now computes)

Read from `cikka-app`: `CartScreen.tsx`, `MallCheckoutScreen.tsx`, `MallProductScreen.tsx`,
`RewardCheckoutScreen.tsx`, `RewardsScreen.tsx`, `context/CartContext.tsx`,
`services/mallService.ts`, `services/razorpayCheckout.ts`, `data/mallCatalog.ts`.

| App rule | Where | Server equivalent |
|---|---|---|
| Unit price = `product.price` from `GET /products?status=ACTIVE` | `mallService.mapBackendProductToMallProduct` | `ProductVariant.price ?? Product.price` from the DB |
| MRP (`originalPrice`) shown struck out when `mrp > price` | same | `mrp`, `line_mrp_total`, `mrp_savings` in the quote (display only; price already reflects it) |
| `subtotal = Σ price × qty` | `CartScreen` | `subtotal` (paise integers internally) |
| Cashback toggle: `min(200, subtotal)`, no balance check | `CartScreen` | `min(₹200, subtotal, signed-in user's ledger cash balance)`; debited through the ledger at fulfilment |
| CI Points: "can only be used in rewards store"; checkout has a dead `ciPointsDiscount` (never set) | `CartScreen`, `MallCheckoutScreen` | Not redeemable on mall orders: `useCiPoints` gives `ci_points: 0` and a note |
| Coupons | none for mall | No server coupons exist: any `couponCode` is rejected `400 COUPON_INVALID` |
| Express delivery `+₹50`, standard free | both screens | Server constant `EXPRESS_DELIVERY_FEE = ₹50` |
| Customer platform fee | not charged on mall (only rewards: ₹9.99 + ₹1.80 GST = ₹11.79) | Server constant; mall `platform_fee_total = 0` (settlement accounting now records `customerPlatformFee = 0` for mall lines instead of a fee nobody paid) |
| Exchange: `payable = max(0, newPrice − originalOrderPrice) + delivery` | `MallCheckoutScreen` | Same, with the credit read from the original `Order.totalAmount` |
| `finalTotal = max(0, subtotal − cashback + delivery)`, rupees, 2 dp | both screens | `total_paise = max(0, subtotal − discounts + fees)`; `total = total_paise / 100` |
| `getProductDiscount` / `MALL_PRODUCTS` | mock catalog | Display-only mock data; never priced server-side. Static reward items (ids 1–4) are rejected as unknown products |

## 2. `POST /api/mall/quote`

Optional user JWT (cashback needs one). Body:

```json
{
  "items": [{ "productId": "uuid", "variantId": "uuid?", "qty": 1 }],
  "deliveryOption": "standard | express",
  "couponCode": null,
  "useCashback": false,
  "useCiPoints": false,
  "exchange": { "orderId": "uuid" }            // or { "orderNumber": "order_X" }; optional
}
```

`items[].id`, `delivery_option`, `apply_cashback`/`use_cashback` are accepted as aliases.
Any `price`/`amount` on items is ignored.

Validation (400/404/409 with `code`): `EMPTY_CART`, `INVALID_QTY` (integer 1–20),
`UNKNOWN_PRODUCT`, `PRODUCT_UNAVAILABLE` (status ≠ ACTIVE), `VARIANT_MISMATCH`,
`INSUFFICIENT_STOCK`, `SELLER_NOT_PAYABLE`, `COUPON_INVALID`, `AUTH_REQUIRED_FOR_CASHBACK`,
`EXCHANGE_NOT_ELIGIBLE`.

Response 200: per-line `unit_price`, `mrp`, `line_total`, `seller_id`; `subtotal`,
`discounts { coupon, cashback, ci_points, total }`, `fees { express_delivery_fee,
platform_fee, platform_fee_gst, platform_fee_total }`, `total`, `total_paise`,
`requires_payment`, `quote_id` (HMAC-signed, 10 min), `quote_hash`, `expires_at`, `notes[]`.

`quote_id` is optional on create-order. If sent, it must verify and match the recomputed
total, otherwise `409 PRICE_CHANGED` with a fresh `quote`.

## 3. Checkout endpoints price on the server

- `POST /api/payment/create-order` and `POST /api/payment/pay-with-card` take the quote body
  (+ shipping fields) and compute the amount with the same pricing function. The Razorpay
  order is created for `total_paise`. A client `amount` / `amount_in_paise`, if present, must
  equal it, else `409 PRICE_CHANGED` (with `quote`) so the buyer never pays a different number
  than the one shown. Production requires a signed-in user (401 otherwise).
- The `RazorpayCheckout.snapshot.pricing` stores the priced lines; fulfilment, settlements
  and transfers use only those. Checkouts recorded before this change (no `pricing`) are
  repriced from their product ids; if that total ≠ the captured amount the payment is refunded.
- Rewards: `initiate-redemption` / `rewards/pay-with-card` need `productId` of an ACTIVE DB
  product. `points_required = round(price)` (1 CI Point = ₹1, as the app shows), value =
  price, fee = ₹11.79 (+ ₹50 express). Client `pointsRequired`/`productValue` are ignored;
  a mismatching client `pointsRequired` gets `409 PRICE_CHANGED`. A signed-in user is required.

## 4. Seller assignment (decision: block checkout)

Each line goes to `Product.sellerId`. No more pincode/name matching, no seller or product
auto-creation. Quote/create-order fail with `409 SELLER_NOT_PAYABLE` when the seller is
suspended or has no Route linked account whose status is `activated`. Rationale: a Route
transfer needs the account at fulfilment; holding unpaid funds with no transfer target
needs manual ops. `product.route.activated` / `account.activated` webhooks mark accounts active.

## 5. Fulfilment: atomic, leased, recoverable (decision: fail the whole cart and refund)

1. Claim: `CREATED | FAILED`, or `PROCESSING` whose `leaseExpiresAt` has passed →
   `PROCESSING`, `leaseExpiresAt = now + 5 min`, `attempts + 1`.
2. One Prisma transaction: re-check and decrement stock, create one `Order` per line
   (`userId` from the checkout), `OrderItem` with the server unit price and qty, a `Settlement`
   per line (`transferStatus = PENDING_TRANSFER`), debit cashback / CI Points through the
   ledger, mark the checkout `stage = DB_COMMITTED`. All or nothing.
3. After commit: Route transfer per settlement. Before transferring on a retry we list the
   payment's transfers and adopt one whose `notes.orderNumber` matches (no double transfer).
   A failed transfer marks that settlement `TRANSFER_FAILED`; the checkout is still FULFILLED
   (customer order exists) and the transfer is retried by the admin resume endpoint.
4. A business failure in step 2 (out of stock, product gone, insufficient balance, repriced
   total mismatch) refunds the whole payment (receipt `ful_<order>`) and ends in `REFUNDED`.
   Any other error leaves `FAILED` (retryable by webhook redelivery or admin).
5. `GET /api/admin/checkouts?status=` and `POST /api/admin/checkouts/:razorpayOrderId/resume`
   (admin JWT): re-confirms the payment with Razorpay, then fulfils (expired lease or FAILED)
   or retries pending transfers (FULFILLED).

## 6. Orders linked to users

`Order.userId` (nullable, indexed). New `GET /api/user/orders/my-orders` and
`GET /api/user/orders/:id` (user JWT) list only `userId = req.user.id`. Returns, exchanges
and eligibility check ownership on `Order.userId` (fallback: checkout `userId`).

## 7. Settlements

- `SettlementStatus` gains `REVERSED` and `FAILED`. Full reversal → `REVERSED`; partial →
  stays `PENDING`, `netPayable` reduced, `transferStatus = PARTIALLY_REVERSED`;
  `transfer.failed` → `FAILED`; `transfer.reversed` → `REVERSED`. Dashboard and settlement
  aggregates only count `PENDING`/`PAID` (seller scope unchanged: `req.seller.id`).
- `settlement.processed` carries only `{ id, amount, utr }` and the linked `account_id`, no
  transfer ids. We call `GET /v1/transfers?recipient_settlement_id=<id>` (all pages) and mark
  only settlements whose `razorpayTransferId` is in that list (and whose seller owns
  `account_id`) as `PAID`/`SETTLED` with the UTR and `recipientSettlementId`. If the fetch
  fails we answer 500 so Razorpay redelivers; nothing is marked.

## 8. Rewards and wallet

- Source of truth: `UserWallet` + `LoyaltyLedger` via `wallet.service`. Every ledger write
  also mirrors `User.ciPoints` / `User.cashbackBalance` (deprecated, read-only mirrors).
- `User.ciPoints` default 100000 → 0; migration resets mirrors from the wallet (users with no
  wallet get 0: the 100000 was never earned).
- Signup bonus: `SIGNUP_BONUS_POINTS` (default 0) credited once through the ledger
  (`EARN_SIGNUP:<userId>`) on first phone verification.
- `GET /api/rewards/balance` requires a user JWT and returns that user's ledger balance; the
  `phone` query is ignored.
- `POST /api/wallet/earn-points|earn-cashback` let any user credit themselves: now admin-only
  (`user_id` in the body).

## 9. Saved cards (Razorpay customer tokens)

`User.razorpayCustomerId` holds the Razorpay customer (created with `fail_existing: 0`).
`create-order`/`pay-with-card` return `customer_id` so Checkout can save and show cards.
`GET /api/cards/saved` lists `GET /v1/customers/:id/tokens` and refreshes the
`UserSavedCard` cache (cache only, keyed by real `token_*` ids); `DELETE /api/cards/:id`
deletes via `DELETE /v1/customers/:id/tokens/:token` for the caller's own customer only.
`POST /api/cards/save|tokenize` no longer accept card details: `410 CARD_SAVE_IN_CHECKOUT`.
Stub mode keeps demo cards.

## 10. Exchange eligibility

`GET|POST /api/returns/exchange/eligibility` (user JWT; `orderId|orderNumber`,
`newProductId`, `newVariantId?`) → `{ eligible, reasons[], credit, new_price, amount_due,
amount_due_paise, refund_due }`. `POST /returns/exchange` runs the same check. A paid upgrade
goes through checkout with `exchange: { orderId }`: the amount is the delta; eligibility is
re-checked before an authorized payment is captured and again inside fulfilment, which files
the exchange itself (no separate new order). A later `/returns/exchange` call for the same
order answers 200 `already_processed: true`.

## 11. Other

- CORS: allowlist from `CORS_ORIGIN` (comma-separated). Requests with no `Origin` (mobile
  apps, curl) pass. Outside production, localhost / 127.0.0.1 / LAN / Expo / ngrok also pass.
- Unknown `/api/*` → 404 (seller routers get `requireSellerAuth` per mount, not a catch-all).
- `updatedAt` default drift on `user_saved_cards` / `user_wallets` fixed.
- Seller `POST /settlements/withdraw` and `POST /settlements/:id/disburse` removed (410 /
  admin-only route remains); public `POST /orders/create` disabled in production;
  `disburseSettlement` refuses simulated payment ids in production.
