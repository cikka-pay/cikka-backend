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
