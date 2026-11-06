# ADR 0002 — Async post-transaction processing with pg-boss

**Status:** Accepted — 2026-11-04

## Context

After a main transaction (e.g. a verified Razorpay payment) we need follow-up work
that shouldn't block the response or fail it: crediting rewards (CI Points +
cashback), emails, notifications, settlement scheduling. Volume is low today, but
the work is money-adjacent, so a lost or double reward credit is not acceptable.
We want something light now that can be swapped for a real broker later.

## Decision

Use **pg-boss** (v12) on the existing PostgreSQL, behind an in-repo typed library,
`src/lib/jobs` (see its README). The library doesn't import any app code, and a test
enforces that.

- `src/lib/jobs/core`: `defineJob`/`defineJobs` (payload types inferred from zod
  schemas), `createJobQueue` (typed facade that validates on enqueue and consume and
  namespaces idempotency keys), and the `JobQueueAdapter<TTx>` provider contract.
- `src/lib/jobs/adapters`: `PgBossAdapter` (prod) and `MemoryAdapter` (tests/dev).
- `src/lib/jobs/testing/contract.ts`: behaviour every adapter must pass (delivery,
  dedupe, delay, retry, dead-letter). The test suite runs it against both adapters.
- `src/jobs/` is the app side: the job catalogue (`definitions.ts`), handlers, and the
  single line that picks the adapter (`index.ts`).
- `enqueue(name, payload, { tx, key, delaySeconds })`:
  - `tx`: typed per adapter (a Prisma tx for pg-boss). The job is written in that
    transaction, giving the transactional-outbox guarantee without an outbox table.
  - `key`: idempotency key, unique per job name.
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
   entries in `src/jobs/definitions.ts` + handlers. Consider moving node-cron jobs to
   `boss.schedule()` so they run exactly once when the API is scaled horizontally.
2. **At scale / multiple services:** write a new `JobQueueAdapter` (e.g. NATS JetStream
   or SQS) that passes `runAdapterContract`, then swap it in `src/jobs/index.ts`. Job
   definitions, handlers and call sites stay unchanged. Keep pg-boss or an outbox for
   jobs that must be enqueued inside a DB transaction, and relay from there.

## Consequences

- pg-boss 12 requires Node ≥ 22.12 (Dockerfile already uses `node:22-alpine`).
- pg-boss creates and migrates its own `pgboss` schema on startup; Prisma migrations
  don't manage it.
- Inspect failed jobs: `SELECT * FROM pgboss.job WHERE name = 'reward.credit.dlq';`
