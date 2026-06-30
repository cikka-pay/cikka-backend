# Architecture

## Shape

```
React (Vite) ──axios + JWT──▶ Express API ──Prisma──▶ PostgreSQL
```

Single Postgres database, single Express process, no queue/worker yet — fine for v1
traffic (one dashboard per seller, low write volume).

## Auth flow

1. Platform operator runs `backend/scripts/create-seller.js "Business Name"`.
2. Script generates a `loginId` (e.g. `CIKKA-7F3K2Q`) and a random password, hashes the
   password with bcrypt, inserts a `Seller` row, and **prints the plaintext credentials to
   the terminal once**. Hand those to the client out-of-band (Slack/email/phone).
3. Seller calls `POST /api/auth/login` with `{ loginId, password }`.
4. Server verifies against the stored hash, returns a JWT (`{ sub: seller.id }`, 7-day
   expiry).
5. Frontend stores the JWT (in memory + localStorage), attaches it as
   `Authorization: Bearer <token>` via the axios instance in `frontend/src/api/client.js`.
6. `backend/src/middleware/auth.middleware.js` verifies the token on every `/api/*` route
   except `/api/auth/login`, and attaches `req.seller = { id }`.

No roles, no refresh tokens, no password reset flow in v1 — single role (seller), and a
lost password means the operator re-runs the create-seller script or a future
`reset-password` script. Add those when there's an actual second user role to design for.

## Data flow for the dashboard

`GET /api/dashboard/summary` and `GET /api/dashboard/settlement-breakdown` don't compute
gross-sales-minus-commission live from raw orders — they read pre-aggregated `Settlement`
rows. In production this implies a scheduled job (cron / queue worker) that, at the end of
each settlement cycle, computes commission + shipping/GST per seller and writes a
`Settlement` row. That job doesn't exist in this scaffold; `prisma/seed.js` inserts
representative rows so the dashboard has real numbers to render. Build the actual payout
job as a separate spec when you're ready (see `specs/`).

## Why Prisma

Chosen in the original stack decision (see `docs/adr/0001-tech-stack.md`). Schema lives in
`backend/prisma/schema.prisma`; migrations are checked into `backend/prisma/migrations/`
once you run `prisma migrate dev` locally — that folder doesn't exist yet in this scaffold
because it's generated on first migration.

## Frontend structure

- `pages/Login.jsx`, `pages/Dashboard.jsx` — route-level components.
- `components/*` — presentational, one per dashboard widget, matching the reference
  design 1:1 (Sidebar, TopBar, StatCard, SettlementBanner, SettlementBreakdown,
  InventoryAlerts, RecentOrders).
- `context/AuthContext.jsx` — holds the JWT + logged-in seller, exposes `login()`/`logout()`.
- `api/client.js` — single axios instance, base URL from `VITE_API_URL`, attaches the JWT.

No global state library (Redux/Zustand) — the dashboard is one screen with a handful of
fetches; React state + context is enough. Reconsider if/when the app grows past the
dashboard into multi-page CRUD for products/orders.
