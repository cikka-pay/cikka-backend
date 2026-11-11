import { createHash } from "crypto";
import { PgBoss, fromPrisma, type PrismaTransactionLike } from "pg-boss";
import type { AdapterSendOptions, JobPolicy, JobQueueAdapter, RawJob } from "../core/types";

export interface PgBossAdapterOptions {
  connectionString: string;
  /** Postgres schema pg-boss owns; created/migrated on start. */
  schema?: string;
  /** Pool size for pg-boss's own connections. */
  poolSize?: number;
  /** Days a dead-lettered job is kept. */
  deadLetterRetentionDays?: number;
  /** How often idle workers poll for new jobs, seconds (>= 0.5). pg-boss default is 2. */
  pollIntervalSeconds?: number;
  onError?: (err: unknown) => void;
}

/**
 * pg-boss adapter — jobs live in the app's own Postgres.
 * Transactions: pass a Prisma interactive-transaction client (`tx`) and the job
 * row is written in that transaction.
 */
export class PgBossAdapter implements JobQueueAdapter<PrismaTransactionLike> {
  readonly name = "pg-boss";
  private readonly boss: PgBoss;
  private readonly dlqRetentionSeconds: number;
  private readonly pollIntervalSeconds?: number;

  constructor(opts: PgBossAdapterOptions) {
    this.boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema ?? "pgboss",
      max: opts.poolSize ?? 4,
    });
    this.dlqRetentionSeconds = (opts.deadLetterRetentionDays ?? 30) * 24 * 3600;
    this.pollIntervalSeconds = opts.pollIntervalSeconds;
    const onError = opts.onError ?? ((err: unknown) => console.error("[jobs:pg-boss]", err));
    this.boss.on("error", onError);
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }

  async declareQueue(name: string, policy: JobPolicy): Promise<void> {
    const dlq = `${name}.dlq`;
    if (policy.deadLetter && !(await this.boss.getQueue(dlq))) {
      await this.boss.createQueue(dlq, { retentionSeconds: this.dlqRetentionSeconds });
    }
    if (!(await this.boss.getQueue(name))) {
      await this.boss.createQueue(name, {
        retryLimit: policy.retry.limit,
        retryDelay: policy.retry.delaySeconds,
        retryBackoff: policy.retry.backoff,
        // pg-boss only accepts a max delay together with backoff.
        ...(policy.retry.backoff && policy.retry.maxDelaySeconds !== undefined
          ? { retryDelayMax: policy.retry.maxDelaySeconds }
          : {}),
        expireInSeconds: policy.timeoutSeconds,
        deadLetter: policy.deadLetter ? dlq : undefined,
      });
    }
  }

  async send(name: string, payload: unknown, opts: AdapterSendOptions<PrismaTransactionLike>): Promise<string | null> {
    return this.boss.send(name, payload as object, {
      // Dedupe via deterministic job id: a duplicate id is ignored and send() returns
      // null, for as long as the job row is retained (including after completion).
      id: opts.dedupeKey ? keyToUuid(opts.dedupeKey) : undefined,
      startAfter: opts.delaySeconds,
      db: opts.tx ? fromPrisma(opts.tx) : undefined,
    });
  }

  async work(name: string, policy: JobPolicy, handler: (job: RawJob) => Promise<void>): Promise<void> {
    const workOpts = {
      localConcurrency: policy.concurrency,
      // pg-boss asserts on an explicit undefined, so only pass it when set.
      ...(this.pollIntervalSeconds !== undefined ? { pollingIntervalSeconds: this.pollIntervalSeconds } : {}),
    };
    await this.boss.work<unknown>(name, workOpts, async (jobs) => {
      for (const job of jobs) {
        await handler({ id: job.id, name: job.name, payload: job.data, attempt: job.retryCount + 1 });
      }
    });
  }
}

/** Stable RFC 4122-shaped UUID (v5-style, SHA-1) for a dedupe key. */
export function keyToUuid(key: string): string {
  const h = createHash("sha1").update(key).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
