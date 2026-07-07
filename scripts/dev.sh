#!/usr/bin/env bash
# scripts/dev.sh — one command to start Postgres + API server
# Usage: npm run dev:docker

set -e

COLOR_GREEN="\033[0;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[0;31m"
COLOR_RESET="\033[0m"

info()    { echo -e "${COLOR_GREEN}[dev]${COLOR_RESET} $*"; }
warn()    { echo -e "${COLOR_YELLOW}[dev]${COLOR_RESET} $*"; }
error()   { echo -e "${COLOR_RED}[dev]${COLOR_RESET} $*"; }

# ─── 1. Start Postgres ───────────────────────────────────────────────────────
info "Starting Postgres container..."
docker compose up -d db

# ─── 2. Wait for Postgres to be healthy ──────────────────────────────────────
info "Waiting for Postgres to be ready..."
MAX_WAIT=30
WAITED=0

until docker compose exec -T db pg_isready -U cikka -d cikka_dashboard -q 2>/dev/null; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    error "Postgres did not become ready within ${MAX_WAIT}s. Aborting."
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

info "Postgres is ready (${WAITED}s)."

# ─── 3. Run pending Prisma migrations ────────────────────────────────────────
info "Applying Prisma migrations..."
npx prisma migrate deploy

# ─── 4. Generate Prisma client (idempotent) ───────────────────────────────────
npx prisma generate --silent 2>/dev/null || true

# ─── 5. Start the API dev server ─────────────────────────────────────────────
info "Starting API server on http://localhost:4000 ..."
echo ""
exec npx tsx watch src/server.ts
