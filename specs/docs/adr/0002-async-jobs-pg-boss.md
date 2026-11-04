# ADR 0002 — Async post-transaction processing with pg-boss

**Status:** Accepted — 2026-11-04

## Context

After a main transaction (e.g. a verified Razorpay payment) we need follow-up work
that shouldn't block the response or fail it: crediting rewards (CI Points +
cashback), emails, notifications, settlement scheduling. Volume is low today, but
the work is money-adjacent, so a lost or double reward credit is not acceptable.
We want something light now that can be swapped for a real broker later.

## Decision

Use **pg-boss** (v12) on the existing PostgreSQL, behind a provider-agnostic
`JobQueue` interface in `src/jobs/`.

- `src/jobs/types.ts` — `JobQueue` interface + typed `JobPayloads` registry. Business
  code imports only this and `jobQueue` from `src/jobs`.
- `src/jobs/pgboss.queue.ts` — the only file that imports pg-boss. Each job gets a
  queue with exponential-backoff retries and a dead-letter queue `<name>.dlq`.
- `src/jobs/handlers/*` — idempotent handlers.
- `enqueue(name, payload, { tx, key, delaySeconds })`:
  - `tx` — a Prisma interactive-transaction client; the job is inserted in that same
    transaction (via pg-boss `fromPrisma`) and only exists if it commits. This is the
    transactional-outbox guarantee without a separate outbox table.
  - `key` — dedupe key, mapped to a deterministic job id; re-enqueueing the same key
    is a no-op while the job is retained.
- Workers run in the API process by default (`JOBS_WORKERS_ENABLED`). To scale, deploy
  the same image as a second Railway service and disable workers on the API.

Delivery is **at-least-once**, so every handler must be idempotent. Wallet credits rely
on `LoyaltyLedger.idempotencyKey` (`EARN_ORDER:<orderId>`, `EARN_CASHBACK:<orderId>`).

## Options considered

| Option | Why not (now) |
|---|---|
| NATS JetStream | Light binary, but a second stateful system to run/back up; single node = no HA; still needs an outbox for reliable publish. Right choice once several services consume the same events. |
| BullMQ + Redis | Adds Redis (must be `noeviction` + AOF); DB commit and enqueue can't be atomic → needs an outbox anyway. |
| Inngest / Trigger.dev / QStash / Hatchet | Third-party (mostly US-hosted) SaaS receiving payment-adjacent data (RBI localisation concern); SDKs shape code; same dual-write problem. |
| graphile-worker | Strong runner-up (faster, LISTEN/NOTIFY). No Prisma adapter (raw-SQL enqueue) and no first-class DLQ. |
| Hand-rolled outbox + `SKIP LOCKED` | Viable, but re-implements retries/backoff/DLQ/stuck-job recovery pg-boss already has. |
| Temporal | Far too heavy for current scale. |

## Migration path

1. **Now:** pg-boss on main Postgres; more jobs (emails, notifications) added as
   `JobPayloads` entries + handlers. Consider moving node-cron jobs to
   `boss.schedule()` so they run exactly once when the API is scaled horizontally.
2. **At scale / multiple services:** keep the `JobQueue`/handler contracts; add an
   adapter (or an outbox relay) publishing to NATS JetStream or SQS/SNS. Handlers and
   idempotency keys stay unchanged.

## Consequences

- pg-boss 12 requires Node ≥ 22.12 (Dockerfile already uses `node:22-alpine`).
- pg-boss creates and migrates its own `pgboss` schema on startup; Prisma migrations
  don't manage it.
- Inspect failed jobs: `SELECT * FROM pgboss.job WHERE name = 'reward.credit.dlq';`
