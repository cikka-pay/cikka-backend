#!/usr/bin/env bash
# scripts/setup.sh — First-time project bootstrap for Cikka Backend
#
# What this does:
#   1. Checks required tools (node, npm, psql OR docker)
#   2. Creates .env from .env.example if not present
#   3. Starts the database (Docker or local Postgres)
#   4. Installs npm dependencies
#   5. Runs prisma generate + migrate dev
#   6. Optionally seeds demo data
#
# Usage:
#   bash scripts/setup.sh           # interactive
#   SKIP_SEED=1 bash scripts/setup.sh   # skip demo data
#   USE_DOCKER_DB=1 bash scripts/setup.sh  # force Docker for Postgres

set -euo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✘${NC}  $*" >&2; exit 1; }
step() { echo -e "\n${YELLOW}▶${NC}  $*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Cikka Backend — Project Setup      ║"
echo "╚══════════════════════════════════════╝"

# ─── 1. Tool checks ───────────────────────────────────────────────────────────
step "Checking required tools"

command -v node >/dev/null 2>&1 || die "node not found — install Node.js 20+"
command -v npm  >/dev/null 2>&1 || die "npm not found"

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[[ "$NODE_MAJOR" -ge 18 ]] || die "Node.js 18+ required (found $(node --version))"

ok "Node $(node --version) / npm $(npm --version)"

HAS_DOCKER=0; HAS_PSQL=0
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && HAS_DOCKER=1
command -v psql   >/dev/null 2>&1 && HAS_PSQL=1

USE_DOCKER_DB="${USE_DOCKER_DB:-0}"

if [[ "$HAS_DOCKER" -eq 1 && "$USE_DOCKER_DB" -eq 1 ]]; then
  DB_BACKEND="docker"
elif [[ "$HAS_PSQL" -eq 1 ]]; then
  DB_BACKEND="local"
elif [[ "$HAS_DOCKER" -eq 1 ]]; then
  DB_BACKEND="docker"
else
  die "Neither psql nor a running Docker daemon found. Install one and retry."
fi

ok "Database backend: $DB_BACKEND"

# ─── 2. .env ──────────────────────────────────────────────────────────────────
step "Environment file"

if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env created from .env.example — review DATABASE_URL before continuing"

  if [[ "$DB_BACKEND" == "docker" ]]; then
    # Patch DATABASE_URL to match docker-compose credentials
    sed -i.bak 's|DATABASE_URL=.*|DATABASE_URL="postgresql://cikka:cikka_dev@localhost:5433/cikka_dashboard?schema=public"|' .env
    rm -f .env.bak
    ok ".env patched for Docker Postgres (cikka:cikka_dev)"
  else
    # Use socket auth with current OS user (Homebrew convention)
    CURRENT_USER="$(whoami)"
    sed -i.bak "s|DATABASE_URL=.*|DATABASE_URL=\"postgresql://${CURRENT_USER}@localhost:5432/cikka_dashboard?schema=public\"|" .env
    rm -f .env.bak
    ok ".env patched for local Postgres (user: ${CURRENT_USER})"
  fi
else
  ok ".env already exists — skipping"
fi

# ─── 3. Database ──────────────────────────────────────────────────────────────
step "Database"

if [[ "$DB_BACKEND" == "docker" ]]; then
  ok "Starting Postgres via docker compose"
  docker compose up -d db
  echo "  Waiting for Postgres to be healthy..."
  for i in $(seq 1 30); do
    if docker compose exec db pg_isready -U cikka -d cikka_dashboard >/dev/null 2>&1; then
      ok "Postgres is ready"; break
    fi
    [[ "$i" -eq 30 ]] && die "Postgres did not become ready in 30 seconds"
    sleep 1
  done
else
  # Local Postgres — try to create DB. "already exists" is fine.
  DB_OUT=$(psql postgres -c "CREATE DATABASE cikka_dashboard;" 2>&1)
  if echo "$DB_OUT" | grep -qE "CREATE DATABASE|already exists"; then
    ok "Database cikka_dashboard ready"
  else
    warn "Could not create database. Output: $DB_OUT"
    warn "Start Postgres first: pg_ctl start -D \$(brew --prefix)/var/postgres"
    die "Cannot continue without a running Postgres"
  fi
fi

# ─── 4. Install dependencies ──────────────────────────────────────────────────
step "Installing npm dependencies"
npm install
ok "Dependencies installed"

# ─── 5. Prisma generate + migrate ─────────────────────────────────────────────
step "Prisma client + migrations"
npx prisma generate
ok "Prisma client generated"

npx prisma migrate dev --name init 2>&1 || npx prisma migrate deploy 2>&1
ok "Database schema up to date"

# ─── 6. Seed ──────────────────────────────────────────────────────────────────
SKIP_SEED="${SKIP_SEED:-0}"
if [[ "$SKIP_SEED" -eq 0 ]]; then
  step "Seeding demo data"
  npm run seed
  ok "Demo data seeded (credentials printed above — save them now)"
else
  ok "Skipping seed (SKIP_SEED=1)"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗"
echo -e "║   Setup complete!                    ║"
echo -e "╚══════════════════════════════════════╝${NC}"
echo ""
echo "  Start the API:   npm run dev"
echo "  Health check:    curl http://localhost:4000/health"
echo "  Prisma Studio:   npm run prisma:studio"
echo ""
