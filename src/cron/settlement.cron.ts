import cron from "node-cron";
import { processDueT7Settlements } from "../services/settlement.service";

/**
 * Scheduled background daemon for auto-releasing matured T+7 settlements.
 * Runs daily at midnight (00:00:00).
 */
export function initSettlementCron() {
  console.log("⏱️  [Settlement Cron] Initializing daily T+7 payout auto-release schedule (00:00 daily)...");

  // Schedule to run every day at midnight (00:00)
  const task = cron.schedule("0 0 * * *", async () => {
    const timestamp = new Date().toISOString();
    console.log(`\n[CRON ${timestamp}] Starting scheduled check for matured T+7 settlements...`);
    try {
      const results = await processDueT7Settlements();
      const successCount = results.filter((r: any) => r.success).length;
      const failureCount = results.filter((r: any) => !r.success).length;

      console.log(
        `[CRON ${timestamp}] T+7 settlement check complete. Total processed: ${results.length} (Success: ${successCount}, Failed: ${failureCount})`
      );
    } catch (err: any) {
      console.error(`[CRON ${timestamp}] Error running T+7 settlement auto-release:`, err.message || err);
    }
  });

  return task;
}
