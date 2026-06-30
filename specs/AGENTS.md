# AGENTS.md — Cikka Seller Dashboard

Read this before making changes. Keep it short; if an instruction here wouldn't change
what an agent does, it doesn't belong here — move it to `docs/`.

## Project

Seller-facing dashboard for the Cikka marketplace. Sellers see pending payouts, gross
sales, orders to pack, low-stock SKUs, a settlement breakdown (commission + shipping/GST
deducted), inventory alerts, and recent orders.

## Stack

- Backend: Node.js + Express, ES modules (`"type": "module"`), PostgreSQL via Prisma.
- Frontend: React + Vite, Tailwind CSS, react-router-dom, lucide-react, axios.
- Auth: JWT. Sellers are provisioned by the platform (`backend/scripts/create-seller.js`)
  with a generated `loginId` + password — there is no self-signup flow. Do not add one
  without an explicit spec for it.

## Commands

```bash
# backend (run from /backend)
npm run dev              # nodemon, http://localhost:4000
npm run seed              # demo data
npm run create-seller     # provision a new seller, prints credentials once
npx prisma studio         # inspect the DB
npx prisma migrate dev    # apply schema changes

# frontend (run from /frontend)
npm run dev               # http://localhost:5173
npm run build
```

## Conventions

- **Money is `Decimal` in Postgres**, never `Float`. Convert to string/number only at the
  API boundary (`toFixed(2)` or `Number()`), never inside Prisma queries.
- **All money/order endpoints are scoped to `req.seller.id`** from the auth middleware.
  Never let a seller query another seller's data — there is no admin role yet, every
  authenticated request is "this seller's own data only."
- **Routes → Controllers → Services.** Routes wire up middleware + call a controller.
  Controllers parse the request/format the response. Services hold the Prisma queries
  and business logic (e.g. settlement math). Don't put Prisma calls directly in routes.
- **Frontend API calls go through `src/api/client.js`** (axios instance with the JWT
  attached) — don't call `fetch` ad hoc in components.
- **Tailwind tokens for this UI** are dark-theme: background `#0a0a0c`, card `#13131a`,
  border `#1f1f29`, accent violet `#7c3aed`, success green `#10b981`, danger
  `#ef4444`/amber `#f59e0b`. Defined in `frontend/tailwind.config.js` — use those names
  (`bg-surface`, `text-accent`, etc.), don't hardcode new hex values in components.
- **Before adding a new dashboard widget or endpoint, write a spec in `specs/`** describing
  the data it needs and where it's scoped from (seller, date range). This is a small
  enough project that skipping specs is tempting — don't; the dashboard aggregates several
  tables and it's easy to scope a query wrong.

## Things that look like bugs but aren't

- `npm run create-seller` prints the plaintext password exactly once and never stores it —
  that's intentional, not a missing feature.
- The settlement breakdown numbers come from the `Settlement` table (pre-computed rows),
  not computed live from `Order` totals. A real payout-cycle job would write those rows;
  this scaffold's seed script stands in for that job.

## Do not

- Don't add a public seller signup endpoint without a spec — auth model is deliberate.
- Don't switch the Postgres access layer away from Prisma without an ADR explaining why.
- Don't put secrets in committed `.env` files — only `.env.example` is checked in.
