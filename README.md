# Cikka — Seller Dashboard Platform

A full-stack marketplace seller dashboard. Sellers manage payouts, track gross sales, dispatch orders, monitor low-stock inventory, and review settlement breakdowns — all scoped to their own account via JWT auth.

```
cikka-backend/   → REST API  (Node.js · Express · TypeScript · PostgreSQL · Prisma)
cikka-fe/        → Seller UI (React 18 · Vite · TypeScript · Tailwind CSS)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser  →  cikka-fe  (localhost:5173)                         │
│               Vite dev proxy: /api/* → localhost:4000           │
│                                                                  │
│  cikka-fe  →  cikka-backend  (localhost:4000)                   │
│               JWT Bearer token on every request                 │
│                                                                  │
│  cikka-backend  →  PostgreSQL  (localhost:5432)                  │
│                    Prisma ORM · pre-computed settlements         │
└─────────────────────────────────────────────────────────────────┘
```

| Service | Port | Description |
|---|---|---|
| `cikka-fe` | `5173` | React dev server (Vite) |
| `cikka-backend` | `4000` | Express REST API |
| PostgreSQL | `5432` | Relational DB (via Docker or local) |

---

## Quick Start

### 1. Start the database

```bash
cd cikka-backend
docker compose up -d db          # starts Postgres 16 in Docker
```

### 2. Bootstrap the backend

```bash
cd cikka-backend
cp .env.example .env             # edit DATABASE_URL & JWT_SECRET
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed                     # loads demo data, prints seller credentials once
npm run dev                      # API → http://localhost:4000
```

### 3. Start the frontend

```bash
cd cikka-fe
npm install
npm run dev                      # UI → http://localhost:5173
```

Open **http://localhost:5173** and sign in with the credentials printed by `npm run seed`.

---

## `cikka-backend` — REST API

### Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript (strict, CommonJS, `tsc → dist/`) |
| Framework | Express 4 |
| Database | PostgreSQL 14+ |
| ORM | Prisma 5 |
| Auth | JWT HS256 · 7-day expiry |
| Dev server | `tsx watch` |
| Container | Docker (multistage Alpine build) |

### Project Structure

```
cikka-backend/
├── src/
│   ├── app.ts / server.ts
│   ├── config/          # Prisma singleton
│   ├── controllers/     # Parse req → call service → send res
│   ├── services/        # Prisma queries + business logic
│   ├── routes/          # Wire middleware + controllers
│   ├── middleware/       # auth.middleware · error.middleware
│   ├── types/           # Express augmentation (req.seller)
│   └── utils/           # asyncHandler · jwt · credentials
├── prisma/              # schema.prisma · seed.ts
├── scripts/             # create-seller.ts · setup.sh
├── specs/               # Feature specs & architecture docs
├── Dockerfile
└── docker-compose.yml
```

### Commands

```bash
npm run dev              # tsx watch → http://localhost:4000
npm run build            # tsc → dist/
npm run start            # node dist/server.js (production)
npm run seed             # load demo data (prints creds once)
npm run create-seller    # provision a new seller (prints creds once)
npm run prisma:migrate   # run DB migrations
npm run prisma:generate  # regenerate Prisma client after schema changes
npm run prisma:studio    # inspect DB in browser
```

### API Endpoints

All routes except `/api/auth/login` require `Authorization: Bearer <token>`.

```
POST   /api/auth/login

GET    /api/dashboard/summary
GET    /api/dashboard/settlement-breakdown?period=week|month

GET    /api/orders?status=all|pending|returns&limit=N
GET    /api/orders/:id

GET    /api/products
GET    /api/products/:id
POST   /api/products

GET    /api/inventory/alerts?limit=N
GET    /api/settlements
GET    /api/returns

GET    /health
```

### Environment Variables

Copy `.env.example` → `.env` and set:

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | see `.env.example` |
| `JWT_SECRET` | HS256 signing secret (`openssl rand -hex 32`) | **must change** |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `PORT` | API port | `4000` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |

### Docker

```bash
# Development — DB only
docker compose up -d db

# Full production stack (DB + API)
docker compose up

# Build production image
docker build -t cikka-backend .
docker run -p 4000:4000 --env-file .env cikka-backend
```

---

## `cikka-fe` — Seller UI

### Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + Vite 5 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v3 + custom design system |
| Routing | react-router-dom v6 |
| HTTP | axios (JWT interceptor) |
| Icons | lucide-react |

### Project Structure

```
cikka-fe/
├── src/
│   ├── api/
│   │   ├── client.ts      # Axios singleton + JWT interceptor (ALL calls go here)
│   │   └── services.ts    # Typed endpoint functions
│   ├── components/
│   │   ├── ui/            # Card · Badge · Spinner
│   │   └── dashboard/     # StatCard · SettlementBreakdown · InventoryAlerts · RecentOrders
│   ├── hooks/             # useAsync — generic loading/error/data wrapper
│   ├── pages/             # LoginPage · DashboardPage
│   ├── router/            # ProtectedRoute · PublicRoute
│   ├── store/             # AuthContext (JWT + seller state)
│   ├── types/             # api.ts — all API response types
│   └── utils/             # currency.ts — ₹ formatter
├── index.html
├── vite.config.ts         # Proxy: /api → localhost:4000
├── tailwind.config.js
└── tsconfig.json
```

### Commands

```bash
npm run dev          # Dev server → http://localhost:5173
npm run type-check   # TypeScript strict check (no emit)
npm run build        # Production build → dist/
npm run preview      # Preview production build
```

### Routes

| Route | Component | Guard |
|---|---|---|
| `/login` | `LoginPage` | Public — redirects to `/dashboard` if already authed |
| `/dashboard` | `DashboardPage` | Protected — redirects to `/login` if not authed |
| `*` | — | Redirects to `/dashboard` |

### Design System

| Token | Value |
|---|---|
| Background | `#0a0a0f` |
| Card surface | `#16161f` |
| Border | `rgba(255,255,255,0.07)` |
| Brand | purple → indigo gradient |
| Font | Inter (Google Fonts) |
| Animations | `animate-slide-up` · `animate-fade-in` |

Component classes: `glass-card`, `btn-primary`, `btn-ghost`, `badge-*` — defined in `src/index.css`.

### Environment Variables (optional)

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL (leave empty in dev — Vite proxy handles it) |

---

## Auth Model

Sellers are **provisioned by the platform operator** — there is no public signup.

```bash
# From cikka-backend:
npm run create-seller -- "Business Name"
# → prints loginId + plaintext password exactly once
```

1. Seller POSTs credentials to `POST /api/auth/login` → receives a JWT.
2. The frontend stores the JWT in `localStorage` under `cikka_token`.
3. Every subsequent request carries `Authorization: Bearer <token>`.
4. The backend middleware attaches `req.seller = { id }` and all Prisma queries scope to that ID.
5. A `401` response anywhere auto-clears the token and redirects to `/login`.

---

## Agent Team

Both repos ship an `.agents/AGENTS.md` that defines specialised agent roles for AI-assisted development:

| Agent | Scope | Responsibilities |
|---|---|---|
| 🎨 **UI/UX** | `components/`, `pages/`, CSS | Visual components, design system, responsive layouts |
| 🔌 **API Integration** | `api/`, `hooks/`, `store/`, `types/` | HTTP calls, typed services, auth state, data hooks |
| 🔍 **QA / Review** | Cross-cutting | Type safety, currency formatting, empty states, spec compliance |

See:
- [`cikka-backend/.agents/AGENTS.md`](./cikka-backend/.agents/AGENTS.md)
- [`cikka-fe/.agents/AGENTS.md`](./cikka-fe/.agents/AGENTS.md)

---

## Key Conventions

| Rule | Detail |
|---|---|
| **Money is a string** | API returns `Decimal` as `string` — format on the frontend only, using `currency.ts` |
| **No ad-hoc fetch** | All API calls go through `cikka-fe/src/api/client.ts` |
| **Seller-scoped data** | Every Prisma query filters by `req.seller.id` — never cross-seller leakage |
| **TypeScript strict** | Both repos compile with `"strict": true` — no `any` casts |
| **Spec-first features** | Write a spec in `cikka-backend/specs/` before adding a new widget or endpoint |
| **No public signup** | Auth model is deliberate — sellers are provisioned by admins only |

---

## Data Model (Summary)

```
Seller ──< Product
       ──< Order ──< Return
       ──< Settlement
```

| Model | Key fields |
|---|---|
| `Seller` | `id`, `businessName`, `loginId`, `passwordHash` |
| `Product` | `id`, `name`, `sku`, `price`, `stockQty`, `lowStockThreshold` |
| `Order` | `id`, `status`, `totalAmount`, `sellerId`, `productId`, `createdAt` |
| `Return` | `id`, `orderId`, `reason`, `status` |
| `Settlement` | `id`, `sellerId`, `status`, `grossSales`, `commissionAmount`, `shippingGstAmount`, `netPayable`, `payoutDate` |

Money columns are `Decimal` in Postgres — returned as `string` from the API, formatted as `₹` on the frontend.
