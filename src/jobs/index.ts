import { config } from "../config/env";
import { PgBossQueue } from "./pgboss.queue";
import { rewardCreditHandler } from "./handlers/reward-credit.handler";
import type { JobQueue } from "./types";

export * from "./types";

/**
 * Process-wide job queue. Swap the adapter here to change providers.
 * Enqueue from anywhere: `await jobQueue.enqueue("reward.credit", payload, { key })`.
 */
export const jobQueue: JobQueue = new PgBossQueue({
  connectionString: process.env.DATABASE_URL as string,
  schema: process.env.JOBS_SCHEMA || "pgboss",
});

/**
 * Start the queue and (unless JOBS_WORKERS_ENABLED=false) register workers.
 * Running workers in the API process is fine at current volume; to scale,
 * deploy a second service with the same image and set JOBS_WORKERS_ENABLED
 * to false on the API.
 */
export async function startJobs(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[jobs] DATABASE_URL not set — async jobs disabled");
    return;
  }
  await jobQueue.start();
  if (config.jobs.workersEnabled) {
    await jobQueue.work("reward.credit", rewardCreditHandler);
    console.log("⚙️  [jobs] pg-boss started; workers: reward.credit");
  } else {
    console.log("⚙️  [jobs] pg-boss started (enqueue only; workers disabled)");
  }
}

export async function stopJobs(): Promise<void> {
  await jobQueue.stop();
}
