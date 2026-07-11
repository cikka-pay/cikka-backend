#!/usr/bin/env bash
# scripts/setup.sh — First-time project bootstrap for Cikka Backend
#
# What this does:
#   1. Checks required tools (node, npm, docker)
#   2. Creates .env from .env.example if not present
#   3. Starts the database via Docker Compose
#   4. Installs npm dependencies
#   5. Runs prisma generate + migrate dev
#   6. Optionally seeds demo data
#
# Usage:
#   npm run setup              # or: bash scripts/setup.sh
#   SKIP_SEED=1 npm run setup  # skip demo data

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

command -v docker >/dev/null 2>&1 || die "Docker not found — install Docker Desktop from https://www.docker.com/products/docker-desktop"
docker info >/dev/null 2>&1       || die "Docker daemon is not running — please start Docker Desktop and retry"

ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"


# ─── 2. .env ──────────────────────────────────────────────────────────────────
step "Environment file"

if [[ ! -f .env ]]; then
  cp .env.example .env
  # Always patch for Docker Compose credentials
  sed -i.bak 's|DATABASE_URL=.*|DATABASE_URL="postgresql://cikka:cikka_dev@localhost:5433/cikka_dashboard?schema=public"|' .env
  rm -f .env.bak
  ok ".env created and configured for Docker Postgres"
else
  ok ".env already exists — skipping"
fi

# ─── 3. Database ──────────────────────────────────────────────────────────────
step "Database"

ok "Starting Postgres via Docker Compose"
docker compose up -d db
echo "  Waiting for Postgres to be healthy..."
for i in $(seq 1 30); do
  if docker compose exec db pg_isready -U cikka -d cikka_dashboard >/dev/null 2>&1; then
    ok "Postgres is ready"; break
  fi
  [[ "$i" -eq 30 ]] && die "Postgres did not become ready in 30 seconds — check: docker compose logs db"
  sleep 1
done

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
