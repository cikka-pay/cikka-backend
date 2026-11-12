import { randomUUID } from "crypto";
import type { AdapterSendOptions, JobPolicy, JobQueueAdapter, RawJob } from "../core/types";

export interface MemoryAdapterOptions {
  /** Multiply every delay (enqueue delay, retry backoff) by this. Tests use e.g. 0.001. */
  timeScale?: number;
  /** Poll interval in ms. */
  pollMs?: number;
}

interface StoredJob extends RawJob {
  runAt: number;
}

/**
 * In-process adapter for unit tests and local dev. Not durable — jobs are lost
 * on restart. Same semantics as the real adapters (dedupe, delay, retry with
 * backoff, dead-letter), so code tested against it behaves the same in prod.
 * Transactions are not supported (`TTx = never`).
 */
export class MemoryAdapter implements JobQueueAdapter<never> {
  readonly name = "memory";
  private readonly queues = new Map<string, StoredJob[]>();
  private readonly seenKeys = new Map<string, Set<string>>();
  private readonly policies = new Map<string, JobPolicy>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly timeScale: number;
  private readonly pollMs: number;
  private running = false;

  constructor(opts: MemoryAdapterOptions = {}) {
    this.timeScale = opts.timeScale ?? 1;
    this.pollMs = opts.pollMs ?? 10;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await Promise.allSettled([...this.inFlight]);
  }

  async declareQueue(name: string, policy: JobPolicy): Promise<void> {
    this.policies.set(name, policy);
    if (!this.queues.has(name)) this.queues.set(name, []);
    if (policy.deadLetter && !this.queues.has(`${name}.dlq`)) this.queues.set(`${name}.dlq`, []);
  }

  async send(name: string, payload: unknown, opts: AdapterSendOptions<never>): Promise<string | null> {
    if (opts.tx !== undefined) throw new Error("[jobs:memory] transactions are not supported");
    if (opts.dedupeKey) {
      const seen = this.seenKeys.get(name) ?? new Set<string>();
      if (seen.has(opts.dedupeKey)) return null;
      seen.add(opts.dedupeKey);
      this.seenKeys.set(name, seen);
    }
    const job: StoredJob = {
      id: randomUUID(),
      name,
      payload: structuredClone(payload),
      attempt: 1,
      runAt: Date.now() + (opts.delaySeconds ?? 0) * 1000 * this.timeScale,
    };
    this.queue(name).push(job);
    return job.id;
  }

  async work(name: string, policy: JobPolicy, handler: (job: RawJob) => Promise<void>): Promise<void> {
    let active = 0;
    const tick = () => {
      if (!this.running) return;
      const q = this.queue(name);
      const now = Date.now();
      while (active < policy.concurrency) {
        const idx = q.findIndex((j) => j.runAt <= now);
        if (idx === -1) break;
        const [job] = q.splice(idx, 1);
        active++;
        const p = this.run(job, policy, handler).finally(() => {
          active--;
          this.inFlight.delete(p);
        });
        this.inFlight.add(p);
      }
      this.schedule(tick);
    };
    this.schedule(tick);
  }

  /** Test helper: jobs currently waiting in a queue (use `<name>.dlq` for dead letters). */
  peek(name: string): ReadonlyArray<RawJob> {
    return this.queue(name).map(({ runAt: _r, ...job }) => job);
  }

  private async run(job: StoredJob, policy: JobPolicy, handler: (job: RawJob) => Promise<void>) {
    try {
      const { runAt: _r, ...raw } = job;
      await handler(raw);
    } catch {
      const retriesDone = job.attempt - 1;
      if (retriesDone < policy.retry.limit) {
        this.queue(job.name).push({ ...job, attempt: job.attempt + 1, runAt: Date.now() + retryDelayMs(policy, retriesDone) * this.timeScale });
      } else if (policy.deadLetter) {
        this.queue(`${job.name}.dlq`).push({ ...job, name: `${job.name}.dlq`, runAt: Date.now() });
      }
    }
  }

  private schedule(fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, this.pollMs);
    this.timers.add(t);
  }

  private queue(name: string): StoredJob[] {
    let q = this.queues.get(name);
    if (!q) this.queues.set(name, (q = []));
    return q;
  }
}

function retryDelayMs(policy: JobPolicy, retriesDone: number): number {
  const { delaySeconds, backoff, maxDelaySeconds } = policy.retry;
  const s = backoff ? delaySeconds * 2 ** retriesDone : delaySeconds;
  return Math.min(s, maxDelaySeconds ?? Infinity) * 1000;
}
