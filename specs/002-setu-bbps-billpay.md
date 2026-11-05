# Spec 002 — BBPS bill pay via Setu pre-built screens

## Goal

Let a logged-in Cikka buyer pay any BBPS bill (electricity, mobile, DTH, credit card,
FASTag…) inside the Cikka app, using Setu BillPay's pre-built screens. Record each payment
on our side for history, support and (optionally) CI Points.

## Decision

- Integration mode: **Setu BillPay pre-built screens with Setu's built-in UPI payment**
  (Axis Bank is the bank behind the payment). Confirmed by Setu's email and the docs.
- **Cikka never touches the money.** No payment gateway, no settlement, no refunds from us.
- Not used: Custom Payment, UPI Setu, BBPS COU API integration (own screens).

Docs read: `docs.setu.co/payments/billpay/pre-built-screens/*` and the OpenAPI spec
`docs.setu.co/api-specs/payments/billpay-v2-pre-built-screens.json`.

## Flow

1. App → `POST /api/bbps/session` (user JWT).
2. Backend gets a Setu token, calls **Create link** with the user's verified mobile and
   `custID = user.id`. Returns `{ link, sessionId }`.
3. App opens `link` in a webview. User picks biller, fetches bill, pays by UPI — all on
   Setu's screens (receipt + SMS by Setu).
4. Setu → `POST /api/webhooks/setu/billpay` with events. We verify the API key, store the
   event, reply 200 fast.
5. App shows bill-pay history from our records. Complaints are raised inside Setu's screens
   (Create link `redirectTo: "disputes"` / `"transactions"` deep-links there).

## Setu APIs we call

| Call | Request | Notes |
|---|---|---|
| `POST {host}/api/v2/auth/token` | `{ clientID, secret }` → `{ token, expiresIn }` | Cache token until shortly before expiry |
| `POST {host}/api/v2/ethereal/link` | Headers `X-PARTNER-ID`, `Authorization: Bearer`. Body: `orgId` (required), `mobileNumber`, `custID`, optional `categoryName`, `billerId`, `billParams[]`, `redirectTo`, `additionalInfo` | Returns `link`, `sessionId`, `traceId`. One-time link: create a new one per visit |

Hosts: `https://sandbox-coudc.setu.co`, `https://qa-coudc.setu.co`, prod `https://coudc.setu.co`.

## Webhook we host

`POST /api/webhooks/setu/billpay`, header `X-BILL-WEBHOOK-API-KEY` (value emailed by Setu).
All payload values are strings. Reply 2xx quickly; Setu retries up to 5 times with backoff
on anything else, so handling must be idempotent.

| Event | Meaning | Our action |
|---|---|---|
| `bill_fetch_success` / `bill_fetch_failure` | Bill fetched / not | Log only (analytics) |
| `bill_collection_failure` | UPI payment failed, no money taken | Mark FAILED |
| `bill_payment_success` | Paid to biller | Mark SUCCESS (+ CI Points, if decided) |
| `bill_payment_failure` | Payment failed | Mark FAILED |
| `bill_payment_refunded` | Money taken, BBPS payment failed → auto refund | Mark REFUNDED (+ reverse CI Points) |
| `dispute_raised` / `dispute_status_change` | Complaint opened / updated | Store dispute status for support |

Key fields: `event`, `status`, `txnId` (BBPS txn id), `orderId` (Setu), `refId`,
`sessionId`, `customerId` (= our `custID`), `mobileNumber`, `billerId`, `billerName`,
`billerCategory`, `billAmount`, `amountPaid`, `paidOn`, `error`; disputes add
`referenceId`, `issueType`, `txnDate`.

## Data model

Reshape `BbpsTransaction` (keyed by Setu's ids, not our own `refID`):

- `setuOrderId` (unique, nullable until a payment event), `bbpsTxnId`, `refId`, `sessionId`
- `userId` (from `customerId`), `mobileNumber`, `billerId`, `billerName`, `category`
- `billAmount`, `amountPaid` as `Decimal`
- `status`: `PENDING | SUCCESS | FAILED | REFUNDED`, `paidOn`, `errorCode`, `errorMessage`
- `disputeRefId`, `disputeStatus`
- `rawPayload` (last event)

New `BbpsWebhookEvent` (append-only): `id`, `event`, dedupe key
`event:(txnId|orderId|refId|referenceId)` unique, `payload`, `receivedAt`. Lets us dedupe
retries and replay.

Status only moves forward: `PENDING → SUCCESS | FAILED`, `SUCCESS → REFUNDED`. Never
overwrite a final status with an earlier event.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/bbps/session` | user JWT | Create Setu link. Body optional: `categoryName`, `billerId`, `redirectTo` |
| `GET /api/bbps/history` | user JWT | Last 50 bill payments (keep, re-point to new model) |
| `GET /api/bbps/history/:id` | user JWT | One payment, scoped to `req.user.id` |
| `POST /api/webhooks/setu/billpay` | API key | Receive Setu events |

## Config (env)

`SETU_BILLPAY_BASE_URL`, `SETU_BILLPAY_CLIENT_ID`, `SETU_BILLPAY_SECRET`,
`SETU_BILLPAY_PARTNER_ID`, `SETU_BILLPAY_ORG_ID`, `SETU_BILLPAY_WEBHOOK_API_KEY`.
Stub mode (`EXTERNAL_SERVICES_MODE=stub`) returns a fake link; real mode **never** falls
back to stub data on error — it returns 502.

## Implementation plan

1. **Setu client** `src/external/setu/billpay.client.ts` (+ stub): token fetch with cache,
   `createLink()`. Errors surface; no silent fallback.
2. **Session endpoint**: route → controller → service. Uses `user.phone` (must be
   `phoneVerified`), `custID = user.id`.
3. **Prisma migration**: reshape `BbpsTransaction`, add `BbpsWebhookEvent`.
4. **Webhook receiver**: constant-time API-key check, insert event (dedupe on unique key),
   upsert `BbpsTransaction` with forward-only status, reply 200. Unknown events: store and
   200.
5. **History endpoints** on the new model.
6. **CI Points hook** (behind a flag until the reward rule is decided): credit on
   `bill_payment_success`, reverse on `bill_payment_refunded`, idempotency key
   `EARN_BBPS:<orderId>` / `DEBIT_BBPS:<orderId>`. Needs new `WalletTxType` values.
7. **Retire old code**: `/setu/v1/*` routes, `setu.controller/service`,
   `setu-auth.middleware`, `/api/bbps/categories|billers|bills/fetch|payments/*`,
   `setu-bbps.client.ts`, `setu.real.ts`, `setu.stub.ts`, their validations, unused env
   vars, and their tests. Drop the `PaymentTransaction` writes from BBPS code.
8. **Tests**: client (token cache, error path), session (auth, unverified phone), webhook
   (bad key → 401, each event, duplicate delivery, out-of-order events), history scoping.
9. **Buyer app** (separate repo, not in this session): "Pay bills" button with BBPS logo,
   webview screen, Android `unload` JS interface / iOS `ios_observer`, open `upi://` and
   other non-`setu.co` links outside the webview.
10. **Go-live**: email webhook URL to `billpay.support@setu.co`, ask for the API key and
    "back to app" button, KYC + agreements, switch to prod host and keys.

## Open questions (for Setu)

- [ ] Our `orgId` (required in Create link) and sandbox `clientID` / `secret` / partner ID.
- [ ] Webhook security beyond `X-BILL-WEBHOOK-API-KEY`: fixed source IPs?
- [ ] How long a Create link URL stays valid.
- [ ] Go-live checklist and timeline for pre-built screens.
- [ ] Enable the "back to app" button after successful payment.
- [ ] Commission per bill paid, and how it is settled.
- [ ] Reconciliation report or API for our transactions.
- [ ] Refund timelines for complaints; per-category payment limits (e.g. credit card).

## Open questions (internal)

- [ ] CI Points / cashback on bill payments: rule, cap, reversal on refund.
- [ ] Which buyer app repo gets the webview screen.

## Acceptance criteria

- [x] `POST /api/bbps/session` returns a working Setu link for a verified user; 401 without
      JWT; 400 if phone not verified; 502 (not fake data) when Setu fails in real mode.
      _Verified in stub mode and with a mocked Setu client (unit + integration tests). A real
      sandbox link is still unverified: needs `orgId` / credentials from Setu (open question)._
- [x] Webhook rejects a wrong or missing API key with 401 and accepts the right one.
- [x] Re-delivering the same event changes nothing and still returns 200.
- [x] A late `bill_payment_failure` never overwrites `SUCCESS` or `REFUNDED`.
- [x] History returns only the caller's payments.
- [x] No `/setu/v1/*` or old `/api/bbps/*` fetch/pay routes remain.

## Status

Steps 1–8 done in this repo (routes wired in `src/routes/index.ts`; old Setu/BBPS code,
config, env vars and tests removed; `PaymentTransaction` model kept for other code, with no
BBPS writes). Tests: `src/__tests__/unit/billpay-*.test.ts` and
`src/__tests__/integration/billpay.test.ts`. API docs: `specs/api-contract.yaml`, `specs/API.md`.

Not done here:
- Step 6 reward rule: CI Points hook is behind `BBPS_REWARDS_ENABLED` (off) until the rule is decided.
- Step 9 (buyer app) and step 10 (go-live with Setu) are outside this repo.
- Unmatched `/api/*` paths (including the retired ones) answer 401 rather than 404, because
  `src/routes/index.ts` ends with a catch-all seller-auth wall. Pre-existing behaviour.
