import type { JobDefinition, JobPolicy, JobRegistry, PayloadSchema, RetryPolicy } from "./types";

export const DEFAULT_RETRY: RetryPolicy = {
  limit: 5,
  delaySeconds: 10,
  backoff: true,
  maxDelaySeconds: 60 * 60,
};

export const DEFAULT_POLICY: JobPolicy = {
  retry: DEFAULT_RETRY,
  timeoutSeconds: 5 * 60,
  concurrency: 1,
  deadLetter: true,
};

export interface DefineJobOptions<T> {
  schema: PayloadSchema<T>;
  retry?: Partial<RetryPolicy>;
  timeoutSeconds?: number;
  concurrency?: number;
  deadLetter?: boolean;
}

/** Define one job type. The payload type is inferred from `schema`. */
export function defineJob<T>(opts: DefineJobOptions<T>): JobDefinition<T> {
  return {
    schema: opts.schema,
    policy: {
      retry: { ...DEFAULT_RETRY, ...opts.retry },
      timeoutSeconds: opts.timeoutSeconds ?? DEFAULT_POLICY.timeoutSeconds,
      concurrency: opts.concurrency ?? DEFAULT_POLICY.concurrency,
      deadLetter: opts.deadLetter ?? DEFAULT_POLICY.deadLetter,
    },
  };
}

/** Identity helper that keeps literal job names in the registry type. */
export function defineJobs<const R extends JobRegistry>(jobs: R): R {
  for (const name of Object.keys(jobs)) {
    if (name.endsWith(".dlq")) throw new Error(`[jobs] "${name}": names ending in .dlq are reserved`);
  }
  return jobs;
}

/** A schema for payload types you don't want to validate at runtime (prefer a real schema). */
export function unchecked<T>(): PayloadSchema<T> {
  return { parse: (input: unknown) => input as T };
}
