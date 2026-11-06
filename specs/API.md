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
| GET | `/settlements` | Yes | List settlement history |

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

## Error Responses

All API errors follow a standard envelope:

```json
{
  "error": "Error message description here"
}
```
HTTP status codes are used appropriately (e.g. 400 for bad requests, 401 for unauthorized, 404 for not found).

---

## Enums Reference

| Field | Values |
|---|---|
| `OnboardingStatus` | INCOMPLETE, SUBMITTED, UNDER_REVIEW, VERIFIED, REJECTED |
| `OrderStatus` | PENDING, PACKED, SHIPPED, DELIVERED, CANCELLED, RETURNED |
| `ProductStatus` | DRAFT, ACTIVE, INACTIVE, OUT_OF_STOCK |
| `SettlementStatus`| PENDING, PAID |
| `ReturnStatus` | REQUESTED, APPROVED, REJECTED, RECEIVED, REFUNDED |
| `BbpsTxnStatus` | PENDING, SUCCESS, FAILED, REFUNDED |
