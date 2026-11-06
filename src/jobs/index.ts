/**
 * App wiring for async jobs. The only place that picks a provider.
 *
 *   import { jobQueue } from "../jobs";
 *   await jobQueue.enqueue("reward.credit", payload, { key: orderId, tx });
 *
 * To switch provider: replace `new PgBossAdapter(...)` with another adapter
 * from src/lib/jobs/adapters that passes the contract suite. Nothing else changes.
 */
import { config } from "../config/env";
import { createJobQueue, type JobHandlers } from "../lib/jobs";
import { PgBossAdapter } from "../lib/jobs/adapters/pgboss";
import { jobs, type CikkaJobs } from "./definitions";
import { rewardCreditHandler } from "./handlers/reward-credit.handler";

export * from "./definitions";

export const jobQueue = createJobQueue({
  jobs,
  adapter: new PgBossAdapter({
    connectionString: process.env.DATABASE_URL as string,
    schema: process.env.JOBS_SCHEMA || "pgboss",
  }),
});

/** Every job's worker. Typed: a handler's payload must match its job's schema. */
export const handlers: JobHandlers<CikkaJobs> = {
  "reward.credit": rewardCreditHandler,
};

/**
 * Start the queue and (unless JOBS_WORKERS_ENABLED=false) register workers.
 * To scale, run a second service from the same image and set
 * JOBS_WORKERS_ENABLED=false on the API.
 */
export async function startJobs(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[jobs] DATABASE_URL not set — async jobs disabled");
    return;
  }
  await jobQueue.start();
  if (config.jobs.workersEnabled) {
    await jobQueue.workAll(handlers);
    console.log(`⚙️  [jobs] ${jobQueue.adapterName} started; workers: ${Object.keys(handlers).join(", ")}`);
  } else {
    console.log(`⚙️  [jobs] ${jobQueue.adapterName} started (enqueue only; workers disabled)`);
  }
}

export async function stopJobs(): Promise<void> {
  await jobQueue.stop();
}
