/**
 * @cikka/jobs — core contracts.
 *
 * Three layers:
 *   1. Job definitions  — name → { payload schema, retry policy } (app owns these).
 *   2. JobQueue<Jobs>   — the typed facade app code talks to (built by `createJobQueue`).
 *   3. JobQueueAdapter  — the provider contract (pg-boss today; NATS/SQS/BullMQ later).
 *
 * App code must only ever see layers 1 and 2. Switching providers = writing a new
 * adapter that passes `runAdapterContract` (see ../testing/contract.ts).
 *
 * Delivery semantics are AT-LEAST-ONCE for every adapter: handlers must be idempotent.
 */

// ── 1. Definitions ───────────────────────────────────────────────────────────

/**
 * Anything with `parse(unknown) => T` — a zod schema fits, but the library
 * does not depend on zod. Throwing from `parse` rejects the payload.
 */
export interface PayloadSchema<T> {
  parse(input: unknown): T;
}

export interface RetryPolicy {
  /** Retries after the first attempt before the job is dead-lettered. */
  limit: number;
  /** Base delay between retries, seconds. */
  delaySeconds: number;
  /** Exponential backoff from `delaySeconds`. */
  backoff: boolean;
  /** Upper bound on a single backoff delay, seconds. */
  maxDelaySeconds?: number;
}

export interface JobPolicy {
  retry: RetryPolicy;
  /** A running attempt older than this is considered failed and retried. */
  timeoutSeconds: number;
  /** Max jobs of this type processed concurrently per worker process. */
  concurrency: number;
  /** Copy exhausted jobs to a dead-letter queue (`<name>.dlq`). */
  deadLetter: boolean;
}

export interface JobDefinition<TPayload> {
  readonly schema: PayloadSchema<TPayload>;
  readonly policy: JobPolicy;
}

/** A registry of job definitions keyed by job name. */
export type JobRegistry = Record<string, JobDefinition<any>>;

export type JobName<R extends JobRegistry> = Extract<keyof R, string>;
export type PayloadOf<R extends JobRegistry, N extends JobName<R>> =
  R[N] extends JobDefinition<infer P> ? P : never;

// ── 2. Typed facade ─────────────────────────────────────────────────────────

export interface EnqueueOptions<TTx> {
  /**
   * Enqueue inside this transaction (adapter-specific type, e.g. a Prisma `tx`
   * for the pg-boss adapter). The job exists only if the transaction commits.
   * Adapters that cannot join a transaction declare `TTx = never`.
   */
  tx?: TTx;
  /** Idempotency key: enqueueing the same (name, key) again is a no-op → returns null. */
  key?: string;
  /** Delay before the job becomes runnable, seconds. */
  delaySeconds?: number;
}

export interface JobContext<N extends string = string> {
  id: string;
  name: N;
  /** 1 on the first attempt. */
  attempt: number;
}

export type JobHandler<TPayload, N extends string = string> = (
  payload: TPayload,
  ctx: JobContext<N>
) => Promise<void>;

/** Map of handlers for every (or some) job in the registry. */
export type JobHandlers<R extends JobRegistry> = {
  [N in JobName<R>]?: JobHandler<PayloadOf<R, N>, N>;
};

export interface JobQueue<R extends JobRegistry, TTx = never> {
  readonly adapterName: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Validates `payload` against the job's schema, then enqueues. Returns job id, or null if deduplicated. */
  enqueue<N extends JobName<R>>(name: N, payload: PayloadOf<R, N>, opts?: EnqueueOptions<TTx>): Promise<string | null>;
  /** Registers a worker. Payloads are re-validated on consume; invalid ones fail the attempt. */
  work<N extends JobName<R>>(name: N, handler: JobHandler<PayloadOf<R, N>, N>): Promise<void>;
  /** Registers several workers at once. */
  workAll(handlers: JobHandlers<R>): Promise<void>;
}

// ── 3. Provider contract ────────────────────────────────────────────────────

export interface AdapterSendOptions<TTx> {
  tx?: TTx;
  /** Already namespaced by job name; adapters map it to their native dedupe mechanism. */
  dedupeKey?: string;
  delaySeconds?: number;
}

export interface RawJob {
  id: string;
  name: string;
  payload: unknown;
  attempt: number;
}

/**
 * What a provider must implement. Untyped on purpose — typing and validation
 * live in the facade, so adapters stay small.
 *
 * Contract (verified by `runAdapterContract`):
 *  - `declareQueue` is idempotent and called before `send`/`work` for a name.
 *  - `send` with a `dedupeKey` already seen for that queue returns null and enqueues nothing.
 *  - `send` honours `delaySeconds`.
 *  - A handler that throws is retried per policy; after exhaustion the job goes to
 *    `<name>.dlq` when `policy.deadLetter` is true.
 *  - `stop` waits for in-flight handlers (graceful) and is safe to call twice.
 */
export interface JobQueueAdapter<TTx = never> {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  declareQueue(name: string, policy: JobPolicy): Promise<void>;
  send(name: string, payload: unknown, opts: AdapterSendOptions<TTx>): Promise<string | null>;
  work(name: string, policy: JobPolicy, handler: (job: RawJob) => Promise<void>): Promise<void>;
}

export type TxOf<A> = A extends JobQueueAdapter<infer T> ? T : never;
