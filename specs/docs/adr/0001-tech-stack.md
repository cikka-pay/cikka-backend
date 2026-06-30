# ADR 0001 — Tech stack and auth model

**Status:** Accepted — 2026-06-28

## Decision

- Backend: Node.js + Express + PostgreSQL + Prisma.
- Frontend: React + Vite (SPA), Tailwind CSS.
- Auth: platform-generated `loginId` + password per seller (no self-signup, no
  third-party auth provider), exchanged for a JWT.

## Why Prisma over raw `pg` / Drizzle / Sequelize

The dashboard's core complexity is aggregation queries across Order/Settlement/Product
scoped by seller and date range. Prisma's typed client reduces the chance of an agent (or
a human) writing a query that leaks across sellers — the relations are explicit in the
schema, and `where: { sellerId }` is easy to grep for and enforce consistently. Migrations
are also easier to review in a PR than hand-written SQL diffs at this project's stage.
Revisit if query complexity outgrows what Prisma expresses well (e.g. heavy
window-function reporting) — raw SQL via `prisma.$queryRaw` is the documented escape
hatch before reaching for a different ORM.

## Why generated-credentials auth instead of self-signup or Clerk/Auth0

The business already knows who its sellers are (they're onboarded onto the marketplace
through an existing process) — there's no need for public registration, email
verification, or social login. A third-party auth provider would add cost and an external
dependency for a single-role, low-user-count internal-facing tool. Plain JWT + bcrypt is
enough. **Revisit this if:** the seller base grows large enough that manual credential
issuance doesn't scale, or a second role (platform admin, sub-users per seller) gets
added — at that point, a real auth provider or a roles table becomes worth the cost.

## Why React + Vite over Next.js

No SEO requirement (it's a logged-in dashboard, not a public site), no need for
server-side rendering or API routes co-located with pages — the API already lives in
Express. Vite's dev server is faster for this kind of SPA and keeps frontend/backend
fully decoupled, which matches the two-repo-like `frontend/` + `backend/` split.
