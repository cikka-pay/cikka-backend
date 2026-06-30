# Cikka Seller Dashboard

A seller-facing analytics dashboard for the Cikka marketplace — payouts, gross sales,
order fulfillment, low-stock alerts, and settlement breakdowns.

## Stack

- **Backend:** Node.js, Express, PostgreSQL, Prisma ORM, JWT auth
- **Frontend:** React (Vite), Tailwind CSS, react-router, lucide-react icons

## Project layout

```
cikka-dashboard/
├── backend/          # Express API + Prisma schema
├── frontend/         # React + Vite dashboard UI
├── docs/             # PRD, architecture, decision records
└── specs/            # Feature specs (spec-driven dev — write before building)
```

See `AGENTS.md` for conventions an AI coding agent (or a human) should follow in this repo.

## Getting started

### 1. Database

```bash
createdb cikka_dashboard   # or use a managed Postgres instance
```

### 2. Backend

```bash
cd backend
cp .env.example .env       # fill in DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run seed                # optional: demo data matching the dashboard mockup
npm run create-seller       # generates a seller login id + password to hand to a client
npm run dev                  # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env        # set VITE_API_URL=http://localhost:4000/api
npm install
npm run dev                  # http://localhost:5173
```

### 4. Log in

Use the `loginId` / `password` printed by `npm run create-seller` (or seeded by `npm run seed`,
which prints a demo login too).

## Auth model

Sellers don't self-register. The platform (you) generates a `loginId` + temporary password
per seller via `backend/scripts/create-seller.js` and hands it to the client out-of-band.
The seller logs in with those credentials and gets a JWT for subsequent requests. See
`docs/ARCHITECTURE.md` for details and `docs/adr/0001-tech-stack.md` for why this approach
was chosen over self-signup or third-party auth.
