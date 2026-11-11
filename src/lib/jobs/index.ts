/**
 * @cikka/jobs — typed, provider-agnostic async job queue.
 *
 * Self-contained: nothing under src/lib/jobs may import app code (enforced by
 * a test), so it can be lifted into its own package unchanged.
 * See ./README.md.
 */
export type {
  PayloadSchema,
  RetryPolicy,
  JobPolicy,
  JobDefinition,
  JobRegistry,
  JobName,
  PayloadOf,
  EnqueueOptions,
  JobContext,
  JobHandler,
  JobHandlers,
  JobQueue,
  JobQueueAdapter,
  AdapterSendOptions,
  RawJob,
  TxOf,
} from "./core/types";
export { defineJob, defineJobs, unchecked, DEFAULT_POLICY, DEFAULT_RETRY } from "./core/define";
export type { DefineJobOptions } from "./core/define";
export { createJobQueue, JobPayloadError } from "./core/queue";
export type { CreateJobQueueOptions } from "./core/queue";

// Adapters are imported from their own paths so unused providers aren't loaded:
//   import { PgBossAdapter } from "../lib/jobs/adapters/pgboss";
//   import { MemoryAdapter } from "../lib/jobs/adapters/memory";
