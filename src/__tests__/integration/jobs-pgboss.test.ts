/**
 * End-to-end test of the pg-boss JobQueue against the real test Postgres:
 * transactional enqueue, dedupe, worker → wallet credit, idempotent retries.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { PgBossQueue, keyToUuid } from "../../jobs/pgboss.queue";
import { rewardCreditHandler } from "../../jobs/handlers/reward-credit.handler";

const hasDb = Boolean(process.env.DATABASE_URL);
const USER_ID = "jobs-test-user-0001";

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("waitFor timed out");
}

async function cleanup() {
  await prisma.loyaltyLedger.deleteMany({ where: { userId: USER_ID } });
  await prisma.userWallet.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

describe.skipIf(!hasDb)("PgBossQueue (integration)", () => {
  let queue: PgBossQueue;

  beforeAll(async () => {
    await cleanup();
    queue = new PgBossQueue({ connectionString: process.env.DATABASE_URL as string, schema: "pgboss_test" });
    await queue.start();
  });

  afterAll(async () => {
    await queue.stop();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS pgboss_test CASCADE`);
    await cleanup();
  });

  it("does not create a job when the surrounding transaction rolls back", async () => {
    const key = `reward.credit:rollback-${Date.now()}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await queue.enqueue(
          "reward.credit",
          { userId: USER_ID, razorpayOrderId: "rb", razorpayPaymentId: "rb", ciPoints: 1, cashbackRupees: 0 },
          { tx, key }
        );
        throw new Error("order insert failed");
      })
    ).rejects.toThrow("order insert failed");

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM pgboss_test.job WHERE id = $1::uuid`,
      keyToUuid(`reward.credit|${key}`)
    );
    expect(rows).toHaveLength(0);
  });

  it("commits the job with the transaction, dedupes by key, and credits the wallet once", async () => {
    const orderId = `order_jobs_${Date.now()}`;
    const payload = { userId: USER_ID, razorpayOrderId: orderId, razorpayPaymentId: "pay_x", ciPoints: 42, cashbackRupees: 7 };

    const id1 = await prisma.$transaction((tx) => queue.enqueue("reward.credit", payload, { tx, key: `reward.credit:${orderId}` }));
    const id2 = await queue.enqueue("reward.credit", payload, { key: `reward.credit:${orderId}` });
    expect(id1).toBeTruthy();
    expect(id2).toBeNull(); // deduplicated by key

    await queue.work("reward.credit", rewardCreditHandler);

    await waitFor(async () => (await prisma.userWallet.findUnique({ where: { userId: USER_ID } }))?.cashPaise === 700);

    // Re-running the handler (simulated at-least-once redelivery) must not double-credit.
    await rewardCreditHandler(payload, { id: "redeliver", name: "reward.credit", retryCount: 1 });

    // Same key after completion is still a no-op.
    expect(await queue.enqueue("reward.credit", payload, { key: `reward.credit:${orderId}` })).toBeNull();

    const wallet = await prisma.userWallet.findUnique({ where: { userId: USER_ID } });
    expect(wallet?.ciPoints).toBe(42);
    expect(wallet?.cashPaise).toBe(700);
    const ledger = await prisma.loyaltyLedger.findMany({ where: { userId: USER_ID, orderId } });
    expect(ledger.map((l) => l.idempotencyKey).sort()).toEqual([`EARN_CASHBACK:${orderId}`, `EARN_ORDER:${orderId}`]);
  });
});
