import type {
  EnqueueOptions,
  JobHandler,
  JobHandlers,
  JobName,
  JobQueue,
  JobQueueAdapter,
  JobRegistry,
  PayloadOf,
} from "./types";

export class JobPayloadError extends Error {
  constructor(readonly jobName: string, readonly cause: unknown) {
    super(`[jobs] invalid payload for "${jobName}": ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "JobPayloadError";
  }
}

export interface CreateJobQueueOptions<R extends JobRegistry, TTx> {
  jobs: R;
  adapter: JobQueueAdapter<TTx>;
}

/**
 * Build the typed facade over a provider adapter.
 *
 *   const queue = createJobQueue({ jobs, adapter: new PgBossAdapter({...}) });
 *   await queue.enqueue("reward.credit", payload, { key: orderId, tx });
 */
export function createJobQueue<R extends JobRegistry, TTx>(
  opts: CreateJobQueueOptions<R, TTx>
): JobQueue<R, TTx> {
  const { jobs, adapter } = opts;
  const declared = new Map<string, Promise<void>>();
  let started = false;

  const definitionOf = (name: string) => {
    const def = jobs[name];
    if (!def) throw new Error(`[jobs] unknown job "${name}"`);
    return def;
  };

  const declare = (name: string): Promise<void> => {
    let p = declared.get(name);
    if (!p) {
      p = adapter.declareQueue(name, definitionOf(name).policy);
      p.catch(() => declared.delete(name)); // allow retry after a transient failure
      declared.set(name, p);
    }
    return p;
  };

  const assertStarted = () => {
    if (!started) throw new Error("[jobs] queue not started — call start() first");
  };

  const parse = <N extends JobName<R>>(name: N, input: unknown): PayloadOf<R, N> => {
    try {
      return definitionOf(name).schema.parse(input);
    } catch (err) {
      throw new JobPayloadError(name, err);
    }
  };

  const queue: JobQueue<R, TTx> = {
    adapterName: adapter.name,

    async start() {
      if (started) return;
      await adapter.start();
      started = true;
    },

    async stop() {
      if (!started) return;
      started = false;
      declared.clear();
      await adapter.stop();
    },

    async enqueue(name, payload, opts: EnqueueOptions<TTx> = {}) {
      assertStarted();
      const data = parse(name, payload);
      await declare(name);
      return adapter.send(name, data, {
        tx: opts.tx,
        dedupeKey: opts.key !== undefined ? `${name}|${opts.key}` : undefined,
        delaySeconds: opts.delaySeconds && opts.delaySeconds > 0 ? opts.delaySeconds : undefined,
      });
    },

    async work(name, handler) {
      assertStarted();
      await declare(name);
      await adapter.work(name, definitionOf(name).policy, async (job) => {
        const data = parse(name, job.payload);
        await handler(data, { id: job.id, name, attempt: job.attempt });
      });
    },

    async workAll(handlers: JobHandlers<R>) {
      for (const name of Object.keys(handlers) as JobName<R>[]) {
        const h = handlers[name];
        if (h) await queue.work(name, h as JobHandler<PayloadOf<R, typeof name>, typeof name>);
      }
    },
  };

  return queue;
}
