# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps
#   Install only production dependencies.
#   Cached as long as package-lock.json doesn't change.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: builder
#   Install ALL deps (including devDeps), generate Prisma client, compile TS.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client (writes into node_modules/@prisma/client)
RUN npx prisma generate

# Compile TypeScript → dist/
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runner
#   Lean production image — compiled JS + prod node_modules only.
#   No TypeScript compiler, no source files, no devDeps.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# OpenSSL is required by Prisma engine binaries
RUN apk add --no-cache openssl

# Security: run as non-root
RUN addgroup --system --gid 1001 cikka && \
    adduser  --system --uid 1001 cikka

WORKDIR /app

# Copy prod deps from deps stage (owned by cikka)
COPY --from=deps    --chown=cikka:cikka /app/node_modules ./node_modules

# Copy compiled output + Prisma schema from builder stage
COPY --from=builder --chown=cikka:cikka /app/dist         ./dist
COPY --from=builder --chown=cikka:cikka /app/prisma       ./prisma
COPY --from=builder --chown=cikka:cikka /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=cikka:cikka /app/node_modules/@prisma ./node_modules/@prisma

# Copy package.json (needed for some runtime checks)
COPY --chown=cikka:cikka package.json ./

USER cikka

EXPOSE 4000

# Ensure migrations are applied before starting (safe to run repeatedly)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
