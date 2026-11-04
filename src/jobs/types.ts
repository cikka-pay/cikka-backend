/**
 * Provider-agnostic async job contracts.
 *
 * Business code depends ONLY on these types and the `jobQueue` singleton
 * exported from `src/jobs/index.ts` — never on pg-boss directly. Swapping the
 * backing provider (graphile-worker, BullMQ, NATS JetStream, SQS, …) means
 * writing a new `JobQueue` adapter; callers and handlers stay unchanged.
 *
 * Delivery semantics: AT-LEAST-ONCE. Every handler MUST be idempotent
 * (e.g. wallet credits rely on LoyaltyLedger.idempotencyKey).
 */

/** Registry of job names → payload shapes. Add new jobs here. */
export interface JobPayloads {
  /** Credit Cikka Mall purchase rewards (CI Points + cashback) to a user's wallet. */
  "reward.credit": RewardCreditPayload;
}

export type JobName = keyof JobPayloads;

export interface RewardCreditPayload {
  userId: string;
  /** Razorpay order id — used as the business key for idempotency. */
  razorpayOrderId: string;
  razorpayPaymentId: string;
  ciPoints: number;
  /** Cashback in rupees (whole or fractional). */
  cashbackRupees: number;
}

/**
 * Anything with Prisma's `$queryRawUnsafe` — i.e. the `tx` client inside
 * `prisma.$transaction(async (tx) => …)`. Passing it makes the enqueue part of
 * that transaction: the job only exists if the transaction commits.
 */
export interface TransactionClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Promise<T>;
}

export interface EnqueueOptions {
  /** Enqueue inside this DB transaction (transactional outbox semantics). */
  tx?: TransactionClient;
  /** Deduplication key — a second enqueue with the same key (per job name) is ignored while the first job is retained. */
  key?: string;
  /** Delay before the job becomes runnable. */
  delaySeconds?: number;
}

export interface JobContext {
  id: string;
  name: JobName;
  /** 0 on first attempt. */
  retryCount: number;
}

export type JobHandler<N extends JobName> = (payload: JobPayloads[N], ctx: JobContext) => Promise<void>;

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Returns the job id, or null when deduplicated by `key`. */
  enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts?: EnqueueOptions): Promise<string | null>;
  work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void>;
}
