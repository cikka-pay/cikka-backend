# Cikka Backend

REST API for the Cikka seller dashboard. Built with **Node.js + Express + TypeScript**, backed by **PostgreSQL via Prisma**.

Sellers see pending payouts, gross sales, orders to pack, low-stock inventory alerts, settlement breakdowns, and recent orders — all scoped to their own account via JWT auth.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript (strict, CommonJS, `tsc` → `dist/`) |
| Framework | Express 4 |
| Database | PostgreSQL 14+ |
| ORM | Prisma 5 |
| Auth | JWT (HS256, 7-day expiry) |
| Dev server | `tsx watch` |
| Container | Docker (multistage Alpine build) |

---

## Quick Start

### Option A — One command (recommended)

```bash
npm run setup
```

The setup script auto-detects whether Docker or a local Postgres is available, creates `.env`, installs dependencies, runs migrations, and seeds demo data. Credentials are printed once at the end.

### Option B — Docker Compose (manual)

```bash
# 1. Start the Postgres container
docker compose up -d db

# 2. Copy and configure env
cp .env.example .env
# Edit DATABASE_URL → postgresql://cikka:cikka_dev@localhost:5432/cikka_dashboard?schema=public

# 3. Install, migrate, seed
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed

# 4. Start the API
npm run dev
# → http://localhost:4000
```

### Option C — Local Postgres (Homebrew / system)

```bash
# Start Postgres (Homebrew example)
pg_ctl start -D $(brew --prefix)/var/postgres
psql postgres -c "CREATE DATABASE cikka_dashboard;"

cp .env.example .env
# Edit DATABASE_URL → postgresql://<your-os-user>@localhost:5432/cikka_dashboard?schema=public

npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
# → http://localhost:4000
```

---

## Environment Variables

Copy `.env.example` → `.env` and set:

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | see `.env.example` |
| `JWT_SECRET` | Secret for signing JWTs — generate with `openssl rand -hex 32` | **must change** |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `PORT` | API port | `4000` |
| `CORS_ORIGIN` | Comma-separated allowed origins | `http://localhost:5173` |

---

## API Endpoints

All routes under `/api/` except `/api/auth/login` require `Authorization: Bearer <token>`.

```
POST   /api/auth/login                   # → { token, seller }

GET    /api/dashboard/summary            # aggregate stats card
GET    /api/dashboard/settlement-breakdown?period=week|month

GET    /api/orders                       # ?status=all|pending|returns  &limit=N
GET    /api/orders/:id

GET    /api/products
GET    /api/products/:id
POST   /api/products

GET    /api/inventory/alerts             # low-stock SKUs, ?limit=N

GET    /api/settlements

GET    /api/returns

GET    /health                           # { status: "ok" }
```

---

## NPM Scripts

```bash
# ── Development ──────────────────────────────────────────────────────────────
npm run setup            # first-time bootstrap (auto-detects DB backend)
npm run dev              # tsx watch → http://localhost:4000
npm run build            # tsc → dist/
npm run start            # node dist/server.js (production)

# ── Data ─────────────────────────────────────────────────────────────────────
npm run seed             # load demo data — prints credentials once
npm run create-seller    # provision a new seller — prints credentials once

# ── Prisma ───────────────────────────────────────────────────────────────────
npm run prisma:generate  # regenerate client after schema changes
npm run prisma:migrate   # prisma migrate dev (creates + applies migration)
npm run prisma:studio    # open Prisma Studio in the browser

# ── Docker ───────────────────────────────────────────────────────────────────
docker compose up -d db          # start only the Postgres container
docker build -t cikka-backend .  # build the production image
docker compose up                # run full stack (DB + app)
```

---

## Project Structure

```
cikka-backend/
├── src/
│   ├── app.ts                 # Express app (middleware, routes)
│   ├── server.ts              # Process entrypoint (listen)
│   ├── config/
│   │   └── prisma.ts          # Shared PrismaClient singleton
│   ├── controllers/           # Parse req → call service → send res
│   │   ├── auth.controller.ts
│   │   ├── dashboard.controller.ts
│   │   ├── inventory.controller.ts
│   │   ├── orders.controller.ts
│   │   ├── products.controller.ts
│   │   ├── returns.controller.ts
│   │   └── settlements.controller.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts  # JWT verification → req.seller
│   │   └── error.middleware.ts # Centralised error handler
│   ├── routes/
│   │   └── index.ts + *.routes.ts
│   ├── services/              # Prisma queries + business logic
│   │   ├── dashboard.service.ts
│   │   └── settlement.service.ts
│   ├── types/
│   │   └── express.d.ts       # Augments req.seller globally
│   └── utils/
│       ├── asyncHandler.ts    # Wraps async handlers for error middleware
│       ├── credentials.ts     # generateLoginId / generatePassword
│       └── jwt.ts             # signToken / verifyToken
├── prisma/
│   ├── schema.prisma          # DB models (Seller, Product, Order, Settlement, Return)
│   └── seed.ts                # Demo data — run via tsx, not compiled
├── scripts/
│   ├── create-seller.ts       # Provision a seller — run via tsx
│   └── setup.sh               # First-time bootstrap agent
├── Dockerfile                 # Multistage build (deps → builder → runner)
├── docker-compose.yml         # Local Postgres 16 for dev
├── .env.example               # Template — copy to .env, never commit .env
├── tsconfig.json              # strict, CommonJS, rootDir: src, outDir: dist
└── specs/                     # Specs & architecture docs (no source code)
```

---

## Docker — Production Build

The `Dockerfile` uses three stages to produce a lean, secure image:

| Stage | What it does |
|---|---|
| `deps` | `npm ci --omit=dev` — cached prod dependencies |
| `builder` | Full install + `prisma generate` + `tsc` |
| `runner` | Alpine + prod deps + `dist/` only, runs as non-root `cikka` user |

```bash
docker build -t cikka-backend .
docker run -p 4000:4000 --env-file .env cikka-backend
```

On startup the container runs `prisma migrate deploy` before `node dist/server.js` — migrations are safe to apply repeatedly.

---

## Auth Model

Sellers are provisioned by the platform operator — **there is no public signup**:

```bash
npm run create-seller -- "Business Name"
# → prints loginId + plaintext password exactly once
```

Login returns a JWT. All subsequent requests send `Authorization: Bearer <token>`. The middleware attaches `req.seller = { id }` and every Prisma query filters by that ID.
