# `src/lib/jobs` — typed, provider-agnostic job queue

A small library for async jobs. App code talks to a **typed facade**, and the
provider (pg-boss today) sits behind an **adapter**. Switching to NATS, SQS or
BullMQ later means writing one adapter. Job definitions, handlers and call
sites stay the same.

It doesn't import any app code (a test enforces this), so you can move it into
its own package (`@cikka/jobs`) without changes.

```
src/lib/jobs/
  core/types.ts        contracts: JobDefinition, JobQueue<Jobs, Tx>, JobQueueAdapter<Tx>
  core/define.ts       defineJob / defineJobs, default policies
  core/queue.ts        createJobQueue: validation, typing, key namespacing
  adapters/pgboss.ts   PgBossAdapter (Postgres, transactional enqueue with Prisma)
  adapters/memory.ts   MemoryAdapter (tests and local dev, not durable)
  testing/contract.ts  runAdapterContract: behaviour every adapter must pass
```

## Usage

```ts
// 1. Define jobs. Payload types are inferred from the schema (zod or anything with .parse).
export const jobs = defineJobs({
  "reward.credit": defineJob({
    schema: z.object({ userId: z.string(), razorpayOrderId: z.string(), ciPoints: z.number().int() }),
    retry: { limit: 8, delaySeconds: 10, backoff: true, maxDelaySeconds: 3600 },
    timeoutSeconds: 300,
  }),
});

// 2. Pick a provider: the only provider-specific line in the app.
const queue = createJobQueue({ jobs, adapter: new PgBossAdapter({ connectionString }) });
await queue.start();

// 3. Enqueue. The name, payload and `tx` type are all checked at compile time.
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ ... });
  await queue.enqueue("reward.credit", { userId, razorpayOrderId, ciPoints: 42 }, {
    tx,                 // the job exists only if this transaction commits
    key: razorpayOrderId, // idempotency key, unique per job name
    delaySeconds: 0,
  });
});

// 4. Handle. Payloads are validated again on consume.
await queue.work("reward.credit", async (payload, ctx) => { /* must be idempotent */ });
```

## Guarantees (all adapters)

- **At-least-once delivery.** A job can run more than once, so handlers must be idempotent.
- **Validation at both ends.** An invalid payload is rejected at `enqueue` (`JobPayloadError`).
  A malformed stored payload fails that attempt, then retries, then dead-letters.
- **`key` dedupe.** Enqueueing the same `(name, key)` again returns `null`.
- **Retries.** Failed jobs retry per `policy.retry`, then go to `<name>.dlq`.
- **`tx` typing.** It is typed by the adapter: `PgBossAdapter` takes a Prisma transaction client.
  `MemoryAdapter` has `TTx = never`, so passing `tx` is a compile error.

## Adding a provider (e.g. NATS JetStream)

1. Create `adapters/nats.ts` implementing `JobQueueAdapter<TTx>`. Five methods: `start`,
   `stop`, `declareQueue`, `send`, `work`. Map `dedupeKey` to the provider's native
   dedupe (JetStream uses the `Nats-Msg-Id` header).
2. Add one line to `src/__tests__/lib/jobs/contract.test.ts`:
   `runAdapterContract("nats", () => new NatsAdapter({...}))`. Make it pass.
3. Change the adapter in `src/jobs/index.ts`.

A broker can't join a Postgres transaction. Keep `PgBossAdapter` (or an outbox table)
for transactional enqueue, and relay from there to the broker. Alternatively, use an
adapter with `TTx = never`: tsc then flags every call site that passes `tx`.

## Checks

```bash
npx vitest run src/__tests__/lib   # facade, contract (memory and pg-boss), boundary
```

```bash
npm run typecheck:jobs             # also checks the @ts-expect-error type guards
```
