import { createHash } from "crypto";
import { PgBoss, fromPrisma } from "pg-boss";
import type { EnqueueOptions, JobHandler, JobName, JobPayloads, JobQueue } from "./types";

/** Per-queue retry policy. Failed jobs past `retryLimit` land in `<name>.dlq`. */
export interface QueuePolicy {
  retryLimit: number;
  retryDelaySeconds: number;
  retryDelayMaxSeconds?: number;
  expireInSeconds?: number;
}

export const DEFAULT_POLICY: QueuePolicy = {
  retryLimit: 8,
  retryDelaySeconds: 10,
  retryDelayMaxSeconds: 60 * 60,
  expireInSeconds: 5 * 60,
};

export interface PgBossQueueOptions {
  connectionString: string;
  /** Postgres schema pg-boss owns (created on first start). */
  schema?: string;
  policies?: Partial<Record<JobName, Partial<QueuePolicy>>>;
}

/** pg-boss–backed JobQueue. Lives in the existing Postgres; no extra infra. */
export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss;
  private readonly policies: PgBossQueueOptions["policies"];
  private readonly ensured = new Set<string>();
  private started = false;

  constructor(opts: PgBossQueueOptions) {
    this.boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema ?? "pgboss",
      max: 4,
    });
    this.policies = opts.policies ?? {};
    this.boss.on("error", (err: unknown) => console.error("[jobs] pg-boss error:", err));
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.ensured.clear();
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }

  /** Create `<name>` and its dead-letter queue `<name>.dlq` once per process. */
  private async ensureQueue(name: JobName): Promise<void> {
    if (this.ensured.has(name)) return;
    const p = { ...DEFAULT_POLICY, ...(this.policies?.[name] ?? {}) };
    const dlq = `${name}.dlq`;
    if (!(await this.boss.getQueue(dlq))) {
      await this.boss.createQueue(dlq, { retentionSeconds: 30 * 24 * 3600 });
    }
    if (!(await this.boss.getQueue(name))) {
      await this.boss.createQueue(name, {
        retryLimit: p.retryLimit,
        retryDelay: p.retryDelaySeconds,
        retryBackoff: true,
        retryDelayMax: p.retryDelayMaxSeconds,
        expireInSeconds: p.expireInSeconds,
        deadLetter: dlq,
      });
    }
    this.ensured.add(name);
  }

  async enqueue<N extends JobName>(name: N, payload: JobPayloads[N], opts: EnqueueOptions = {}): Promise<string | null> {
    if (!this.started) throw new Error("[jobs] queue not started");
    await this.ensureQueue(name);
    return this.boss.send(name, payload as object, {
      // A dedupe key becomes a deterministic job id: re-sending the same key is a
      // no-op (returns null) for as long as the job is retained — including after
      // it completed — under the default `standard` queue policy.
      id: opts.key ? keyToUuid(`${name}|${opts.key}`) : undefined,
      startAfter: opts.delaySeconds && opts.delaySeconds > 0 ? opts.delaySeconds : undefined,
      db: opts.tx ? fromPrisma(opts.tx) : undefined,
    });
  }

  async work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void> {
    if (!this.started) throw new Error("[jobs] queue not started");
    await this.ensureQueue(name);
    await this.boss.work<JobPayloads[N]>(name, async (jobs) => {
      // Default batchSize is 1; loop for safety. A throw fails the job → retry/backoff → DLQ.
      for (const job of jobs) {
        await handler(job.data, { id: job.id, name, retryCount: (job as any).retryCount ?? 0 });
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
