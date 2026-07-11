# AGENTS.md — Cikka Seller Dashboard

Read this before making changes. Keep it short; if an instruction here wouldn't change
what an agent does, it doesn't belong here — move it to `docs/` or `README.md`.

## Project

Seller-facing dashboard for the Cikka marketplace. Sellers see pending payouts, gross
sales, orders to pack, low-stock SKUs, a settlement breakdown (commission + shipping/GST
deducted), inventory alerts, and recent orders.

## Stack

- Backend: Node.js + Express, **TypeScript** (CommonJS, compiled with `tsc`, dev via `tsx`), PostgreSQL via Prisma.
- Frontend: React + Vite, Tailwind CSS, react-router-dom, lucide-react, axios.
- Auth: JWT. Sellers are provisioned by the platform (`scripts/create-seller.ts`)
  with a generated `loginId` + password — there is no self-signup flow. Do not add one
  without an explicit spec for it.

## Repo Structure

```
cikka-backend/
├── src/           # compiled TypeScript source (tsc → dist/)
│   ├── app.ts / server.ts
│   ├── config/    # prisma singleton
│   ├── controllers/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── types/     # express.d.ts augments req.seller
│   └── utils/
├── prisma/        # schema.prisma + seed.ts (run via tsx, not compiled)
├── scripts/
│   ├── create-seller.ts   # provision a seller (tsx)
│   └── setup.sh           # first-time bootstrap agent
├── Dockerfile             # multistage production build
├── docker-compose.yml     # local Postgres for dev
└── specs/                 # specs & docs only — no source code
```

## First-time Setup

```bash
# Requires Docker Desktop to be running. One command does everything.
npm run setup

# Or with demo data skipped:
SKIP_SEED=1 npm run setup
```

## Commands

```bash
# Development
npm run dev              # tsx watch, http://localhost:4000
npm run build            # tsc → dist/
npm run start            # node dist/server.js

# Data
npm run seed             # load demo data (tsx prisma/seed.ts)
npm run create-seller    # provision a new seller, prints credentials once

# Prisma
npm run prisma:migrate   # prisma migrate dev
npm run prisma:studio    # inspect the DB
npm run prisma:generate  # regenerate Prisma client after schema changes

# Docker
docker compose up -d db          # start only the Postgres container
docker build -t cikka-backend .  # build the production image
docker compose up                # run full stack (DB + app)
```

## Conventions

- **TypeScript strict mode is on.** All new files must compile without errors.
- **Express type augmentation**: `req.seller` is declared in `src/types/express.d.ts`.
  Do not cast `req as any` — extend the type declaration instead.
- **Money is `Decimal` in Postgres**, never `Float`. Convert to string/number only at the
  API boundary (`toFixed(2)` or `Number()`), never inside Prisma queries.
- **All money/order endpoints are scoped to `req.seller.id`** from the auth middleware.
  Never let a seller query another seller's data — there is no admin role yet, every
  authenticated request is "this seller's own data only."
- **Routes → Controllers → Services.** Routes wire up middleware + call a controller.
  Controllers parse the request/format the response. Services hold the Prisma queries
  and business logic (e.g. settlement math). Don't put Prisma calls directly in routes.
- **Frontend API calls go through `src/api/client.ts`** (axios instance with the JWT
  attached) — don't call `fetch` ad hoc in components.
- **Before adding a new dashboard widget or endpoint, write a spec in `specs/`** describing
  the data it needs and where it's scoped from (seller, date range).

## Things that look like bugs but aren't

- `npm run create-seller` prints the plaintext password exactly once and never stores it —
  that's intentional, not a missing feature.
- The settlement breakdown numbers come from the `Settlement` table (pre-computed rows),
  not computed live from `Order` totals. A real payout-cycle job would write those rows;
  this scaffold's seed script stands in for that job.
- `prisma/seed.ts` and `scripts/create-seller.ts` are excluded from `tsc` compilation
  and run directly via `tsx` — they don't land in `dist/`.

## Do not

- Don't add a public seller signup endpoint without a spec — auth model is deliberate.
- Don't switch the Postgres access layer away from Prisma without an ADR explaining why.
- Don't put secrets in committed `.env` files — only `.env.example` is checked in.
- Don't remove `"strict": true` from `tsconfig.json` without a good reason.
