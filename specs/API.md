# Cikka Seller API Reference

## Overview

The Cikka Seller API provides programmatic access to manage seller operations, including onboarding, products, orders, inventory, settlements, and notifications.

**Base URL**: `http://localhost:4000/api`

### Authentication

Most endpoints require a Bearer JWT token. Pass the token in the `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

> [!NOTE]
> During development, you can bypass real OTPs by using `111111` as the OTP for any phone number or email, or use the demo seed credentials (`phone: 9999999999`, `password: password123`).

---

## Endpoint Reference

### 1. Authentication (`/auth`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup/send-phone-otp` | No | Send OTP for phone verification |
| POST | `/auth/signup/verify-phone-otp` | No | Verify phone OTP & get temporary token |
| POST | `/auth/signup/send-email-otp` | Yes | Send OTP to email |
| POST | `/auth/signup/verify-email-otp` | Yes | Verify email OTP |
| POST | `/auth/signup/set-password` | Yes | Set password and finalize signup |
| POST | `/auth/signin/send-otp` | No | Send signin OTP |
| POST | `/auth/signin/verify-otp` | No | Verify signin OTP |
| POST | `/auth/forgot-password/send-otp` | No | Send reset OTP |
| POST | `/auth/forgot-password/verify-otp` | No | Verify reset OTP & get reset token |
| POST | `/auth/forgot-password/reset` | Yes | Reset password |
| GET  | `/auth/me` | Yes | Get current authenticated user profile |

**Example Signin Verification:**
```bash
curl -X POST http://localhost:4000/api/auth/signin/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9999999999", "otp":"111111"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR...",
  "seller": {
    "id": "uuid-1234",
    "phone": "9999999999",
    "onboardingStatus": "VERIFIED"
  }
}
```

---

### 2. Onboarding (`/onboarding`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/onboarding` | Yes | Get current onboarding state |
| PATCH | `/onboarding/step/1` | Yes | Update Step 1 (Business Info) |
| PATCH | `/onboarding/step/2` | Yes | Update Step 2 (Legal Info) |
| POST | `/onboarding/kyb/verify-gst` | Yes | Verify GST Number |
| POST | `/onboarding/kyb/verify-pan` | Yes | Verify PAN Number |
| POST | `/onboarding/kyb/verify-cin` | Yes | Verify CIN Number |
| PATCH | `/onboarding/step/3` | Yes | Update Step 3 (Authorized Signatory) |
| POST | `/onboarding/kyb/send-aadhaar-otp` | Yes | Send Aadhaar OTP |
| POST | `/onboarding/kyb/verify-aadhaar-otp`| Yes | Verify Aadhaar OTP |
| PATCH | `/onboarding/step/4` | Yes | Update Step 4 (Bank Account) |
| POST | `/onboarding/kyb/verify-bank` | Yes | Verify Bank Account via penny drop |
| PATCH | `/onboarding/step/5` | Yes | Update Step 5 (Brand & Logistics) |
| POST | `/onboarding/upload/logo` | Yes | Upload Brand Logo |
| PATCH | `/onboarding/step/6` | Yes | Update Step 6 (Agreements) |
| POST | `/onboarding/submit` | Yes | Submit onboarding application for review |

---

### 3. Dashboard (`/dashboard`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/summary` | Yes | Get high-level metrics for dashboard home |
| GET | `/dashboard/settlement-breakdown` | Yes | Get recent settlement breakdown (`?period=week|month`) |

---

### 4. Products (`/products`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/products` | Yes | List all products with pagination and filters |
| GET | `/products/:id` | Yes | Get product details by ID |
| POST | `/products` | Yes | Create a new product |
| PATCH | `/products/:id` | Yes | Update an existing product |
| DELETE| `/products/:id` | Yes | Delete a product |
| PATCH | `/products/:id/variants/:variantId` | Yes | Update a product variant |

**Example Create Product:**
```bash
curl -X POST http://localhost:4000/api/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Super Serum",
    "sku": "SERUM-001",
    "price": 499.00
  }'
```

---

### 5. Orders (`/orders`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/orders` | Yes | List orders (`?status=PENDING&page=1`) |
| GET | `/orders/:id` | Yes | Get order details |
| PATCH | `/orders/:id/status` | Yes | Update order status and tracking info |

---

### 6. Inventory (`/inventory`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/inventory/alerts` | Yes | Get low stock product alerts |
| PATCH | `/inventory/restock` | Yes | Restock a product or variant |

---

### 7. Settlements (`/settlements`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/settlements` | Yes | List settlement history (`?status=ALL\|PENDING\|PAID\|REVERSED\|FAILED`) |
| POST | `/settlements/withdraw`, `/settlements/:id/disburse` | Yes | **410 Gone** (spec 003): payouts are released automatically; ops use admin `POST /razorpay-route/disburse/:id` |

Payout totals on the dashboard count only `PENDING`/`PAID` settlements; `REVERSED` and
`FAILED` rows are never payable.

---

### 8. Returns (`/returns`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/returns` | Yes | List return requests |
| PATCH | `/returns/:id/status` | Yes | Update return request status |

---

### 9. Notifications (`/notifications`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | Yes | Get all notifications |
| POST | `/notifications/mark-all-read` | Yes | Mark all notifications as read |
| PATCH | `/notifications/:id/read` | Yes | Mark a specific notification as read |

---

### 10. Settings (`/settings`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/settings/profile` | Yes | Get seller profile settings |
| GET | `/settings` | Yes | Get notification/app preferences |
| PATCH | `/settings` | Yes | Update preferences |

---

### 11. Hubble Money Gift Cards & Coupons (`/hubble`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/hubble/brands` | No | Discover 400+ partner brands/coupons (Live REST API) |
| GET | `/hubble/brands/:id` | No | Get brand & voucher details by product ID |
| POST | `/hubble/orders` | Optional | Purchase/generate gift card vouchers via Hubble Partner API |
| GET | `/hubble/wallet` | No | Check partner wallet balance |
| GET | `/hubble/status` | No | Integration status (Mock vs Live REST API) |
| POST | `/hubble/sso-token` | Optional | Generate Hubble SSO token & embed URL |
| GET | `/hubble/balance` | No | CI Points balance query hook for Hubble |
| POST | `/hubble/debit` | No | Debit CI Points hook for Hubble |
| POST | `/hubble/reverse` | No | Reverse CI Points hook for Hubble |

---

### 12. BBPS Bill Pay via Setu (`/bbps`, `/webhooks/setu/billpay`)

Spec: `specs/002-setu-bbps-billpay.md`. Bill payment happens on Setu's pre-built screens;
Cikka never touches the money. "User" means a mobile-app user JWT (not a seller token).

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/bbps/session` | User | Create a one-time Setu BillPay link for the caller |
| GET | `/bbps/history` | User | Caller's last 50 bill payments, newest first |
| GET | `/bbps/history/:id` | User | One of the caller's bill payments (404 if not theirs) |
| POST | `/webhooks/setu/billpay` | `X-BILL-WEBHOOK-API-KEY` | Setu BillPay events (called by Setu only) |

**`POST /bbps/session`** — body optional: `categoryName?` (string), `billerId?` (string),
`redirectTo?` (`"transactions"` \| `"disputes"`).

```json
{ "success": true, "link": "https://...setu.co/...", "sessionId": "..." }
```

Errors: `400` validation / `PHONE_NOT_VERIFIED` / `INVALID_PHONE`, `401` no JWT,
`404` `USER_NOT_FOUND`, `502` `SETU_UNAVAILABLE` (real mode never returns a fake link).
Error body: `{ "success": false, "error": "...", "code": "PHONE_NOT_VERIFIED", "traceId"?: "..." }`.

**`GET /bbps/history`** → `{ "success": true, "history": [BillpayHistoryItem] }`;
**`GET /bbps/history/:id`** → `{ "success": true, "payment": BillpayHistoryItem }`.

```json
{
  "id": "uuid", "setuOrderId": "...", "bbpsTxnId": "...", "refId": "...",
  "billerId": "BESCOM000KAR01", "billerName": "BESCOM", "category": "Electricity",
  "mobileNumber": "9876543210", "billAmount": "601.00", "amountPaid": "601.00",
  "status": "SUCCESS", "paidOn": "2026-11-05T08:33:27.000Z",
  "errorCode": null, "errorMessage": null, "disputeRefId": null, "disputeStatus": null,
  "createdAt": "...", "updatedAt": "..."
}
```

Money fields are strings with 2 decimals; nullable fields are `null` when Setu didn't send them.

**`POST /webhooks/setu/billpay`** — JSON body with `event` (required) plus Setu's string fields
(`status`, `txnId`, `orderId`, `refId`, `sessionId`, `customerId`, `mobileNumber`, `billerId`,
`billerName`, `billerCategory`, `billAmount`, `amountPaid`, `paidOn`, `error`; disputes add
`referenceId`, `issueType`, `txnDate`). Responses: `200 {"status":"acknowledged"}`,
`200 {"status":"duplicate"}` for a re-delivery, `400` bad body / missing `event`,
`401` wrong/missing key (or no key configured), `500 {"status":"error"}` when processing failed
(Setu retries). Status is forward-only: a late `bill_payment_failure` never overwrites
`SUCCESS` or `REFUNDED`.

---

### 13. Cikka Mall checkout, rewards, saved cards, buyer orders (spec 003)

Auth column: **User** = mobile-app user JWT, **Opt** = user JWT optional, **Admin** = admin-panel JWT.
All money is computed on the server from `Product` / `ProductVariant` rows; client prices and
totals are never trusted. Amounts are rupees (2 dp) unless the field ends in `_paise`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/mall/quote` | Opt | Server-priced cart breakdown + short-lived `quote_id` |
| POST | `/payment/create-order` | Opt (User in production) | Price cart, create Razorpay order for the server total |
| POST | `/payment/pay-with-card` | Opt (User in production) | Same pricing, for a saved card (token) |
| POST | `/payment/verify-payment`, `/payment/verify-card-otp` | Opt | Confirm with Razorpay, fulfil once (200 / 202 processing / 409 rejected+refunded) |
| GET | `/user/orders/my-orders` | User | The buyer's own orders (`?status=&limit=&cursor=`) |
| GET | `/user/orders/:id` | User | One of the buyer's orders (id or order number), else 404 |
| GET | `/rewards/balance` | User | The caller's ledger balance (`?phone=` ignored) |
| POST | `/rewards/initiate-redemption`, `/rewards/pay-with-card` | User | Price reward from DB (`productId`), fee ₹11.79 / ₹61.79 |
| POST | `/rewards/confirm-redemption`, `/rewards/verify-card-otp` | User | Confirm fee payment, burn points via ledger once |
| GET | `/cards/saved` | User | Razorpay customer tokens of the caller (+ `customer_id`) |
| POST | `/cards/save`, `/cards/tokenize` | User | **410** `CARD_SAVE_IN_CHECKOUT` (cards are saved in Razorpay Checkout) |
| DELETE | `/cards/:id` | User | Delete one of the caller's tokens at Razorpay |
| GET/POST | `/returns/exchange/eligibility` | User | Pre-check an exchange before taking payment |
| POST | `/returns/exchange` | User | File an exchange (upgrade must be paid via checkout: 402 otherwise) |
| POST | `/wallet/earn-points`, `/wallet/earn-cashback` | Admin | Manual credits (body `user_id`); no longer user-callable |
| GET | `/admin/checkouts` | Admin | Stuck / failed checkouts (`?status=stuck` default) |
| POST | `/admin/checkouts/:razorpayOrderId/resume` | Admin | Resume fulfilment or retry pending seller transfers |

#### `POST /mall/quote`

```json
{
  "items": [
    { "productId": "4f1c…", "qty": 2 },
    { "productId": "9a2e…", "variantId": "77d0…", "qty": 1 }
  ],
  "deliveryOption": "express",
  "couponCode": null,
  "useCashback": true,
  "useCiPoints": false,
  "exchange": null
}
```

Aliases accepted: `items[].id` / `product_id`, `delivery_option`, `apply_cashback`, `exchange.orderNumber`.
Any `price` / `amount` in the body is ignored.

```json
{
  "success": true,
  "quote_id": "q_eyJ2IjoxLCJo….3kQ…",
  "quote_hash": "9d1f…",
  "expires_at": "2026-11-07T10:10:00.000Z",
  "currency": "INR",
  "delivery_option": "express",
  "lines": [
    { "product_id": "4f1c…", "variant_id": null, "variant": null, "name": "Linen Shirt", "brand": "Linen Co",
      "seller_id": "s-1", "qty": 2, "unit_price": 1499, "unit_price_paise": 149900, "mrp": 1999,
      "line_total": 2998, "line_total_paise": 299800, "line_mrp_total": 3998, "mrp_savings": 1000 },
    { "product_id": "9a2e…", "variant_id": "77d0…", "variant": "Size: M", "name": "Runner", "brand": "Shoe Co",
      "seller_id": "s-2", "qty": 1, "unit_price": 849, "unit_price_paise": 84900, "mrp": null,
      "line_total": 849, "line_total_paise": 84900, "line_mrp_total": 849, "mrp_savings": 0 }
  ],
  "subtotal": 3847, "subtotal_paise": 384700,
  "mrp_total": 4847, "mrp_savings": 1000,
  "discounts": { "coupon": 0, "cashback": 100, "ci_points": 0, "total": 100, "total_paise": 10000 },
  "fees": { "express_delivery_fee": 50, "platform_fee": 0, "platform_fee_gst": 0, "platform_fee_total": 0 },
  "exchange": null,
  "cashback_balance": 100,
  "total": 3797, "total_paise": 379700,
  "requires_payment": true,
  "notes": ["Cashback limited to your balance (₹100.00)."]
}
```

Rules: unit price = variant price ?? product price; only `ACTIVE` products of sellers with an
activated Route account; cashback = min(₹200, goods, ledger cash balance) (signed-in only);
CI Points are not redeemable on mall orders; no coupons exist (`COUPON_INVALID`); express ₹50;
no customer platform fee on mall orders; exchange `total = max(0, new price − original order
total) + express`. Errors: `{ success:false, error, code, ...details }` with codes `EMPTY_CART`,
`INVALID_QTY`, `UNKNOWN_PRODUCT` (404), `PRODUCT_UNAVAILABLE`, `VARIANT_MISMATCH`,
`INSUFFICIENT_STOCK`, `SELLER_NOT_PAYABLE`, `COUPON_INVALID`, `AUTH_REQUIRED_FOR_CASHBACK` (401),
`EXCHANGE_NOT_ELIGIBLE`, `EXCHANGE_SINGLE_ITEM`.

#### `POST /payment/create-order`

Body = quote body + shipping fields (`customer_name`, `customer_email`, `customer_phone`,
`delivery_address`, `pincode`, `city`, `carrier_name`) + optional `quote_id`, `amount` (paise),
`receipt`, `notes`. If `amount`/`amount_in_paise` or `quote_id` disagree with the server
total → `409 PRICE_CHANGED { quote }`. Total 0 → `400 NO_PAYMENT_REQUIRED`; < ₹1 → `400 AMOUNT_TOO_SMALL`.
Response: `{ success, order_id, amount (paise), amount_in_paise, currency, key_id, customer_id, quote }`.
Pass `customer_id` to Razorpay Checkout so the buyer can save / reuse cards.

#### `POST /payment/pay-with-card`

Same body, plus `card_id` (our card id) or `token_id` (Razorpay token) of the caller's card
(404 `CARD_NOT_FOUND` otherwise); `amount` here is rupees. Real mode:
`{ requires_checkout: true, requires_otp: false, order_id, key_id, customer_id, token_id, bank_name,
card_network, card_last4, amount, amount_in_paise, quote }`. Stub mode: simulated OTP session.

#### Verify responses

`200 { verified, processed_orders[{ order_number, seller_id, product_id, qty, unit_price, line_total,
transfer_status, settlement_id, net_payable }], pricing, cashback_earned, ci_points_earned }`,
`202 { processing: true }`, or `409 { verified: true, refunded: true, code, refund_id }` when the paid
cart could not be fulfilled in full (out of stock, product withdrawn, exchange no longer allowed…)
and the whole payment was refunded. `403 WRONG_USER` when another user's token verifies.

#### `GET /returns/exchange/eligibility?orderNumber=&newProductId=&newVariantId=`

`{ eligible, reasons[{code,message}], order_id, order_number, credit, new_product_id, new_price,
amount_due, amount_due_paise, refund_due, requires_payment, same_seller }`. Reason codes:
`ORDER_NOT_FOUND`, `NOT_YOUR_ORDER`, `ORDER_CLOSED`, `RETURN_IN_PROGRESS`, `WINDOW_CLOSED` (7 days after
delivery), plus any quote error code for the replacement. Upgrades are paid with
`create-order { items:[{productId}], exchange:{ orderNumber } }`; fulfilment files the exchange
and a later `POST /returns/exchange` answers `200 { already_processed: true }`.

#### `GET /rewards/balance`

`{ success, phone, ci_points, cashback_balance, source: "ledger" }` for the caller only.

---

## Error Responses

All API errors follow a standard envelope:

```json
{
  "error": "Error message description here"
}
```
HTTP status codes are used appropriately (e.g. 400 for bad requests, 401 for unauthorized, 404 for not found).
Unknown `/api/*` paths return **404** (they used to return 401). Payment and pricing endpoints
add a machine-readable `code` and `success: false`.

---

## Enums Reference

| Field | Values |
|---|---|
| `OnboardingStatus` | INCOMPLETE, SUBMITTED, UNDER_REVIEW, VERIFIED, REJECTED |
| `OrderStatus` | PENDING, PACKED, SHIPPED, DELIVERED, CANCELLED, RETURNED, EXCHANGE |
| `ProductStatus` | DRAFT, ACTIVE, INACTIVE, OUT_OF_STOCK |
| `SettlementStatus`| PENDING, PAID, REVERSED, FAILED |
| `RazorpayCheckout.status` | CREATED, PROCESSING (leased), FULFILLED, FAILED, REFUNDED |
| `ReturnStatus` | REQUESTED, APPROVED, REJECTED, RECEIVED, REFUNDED |
| `BbpsTxnStatus` | PENDING, SUCCESS, FAILED, REFUNDED |
