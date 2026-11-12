/**
 * End-to-end: app job catalogue + pg-boss adapter + real Postgres + wallet.
 * Covers transactional enqueue, dedupe and idempotent crediting.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma";
import { createJobQueue } from "../../lib/jobs";
import { PgBossAdapter } from "../../lib/jobs/adapters/pgboss";
import { jobs } from "../../jobs/definitions";
import { rewardCreditHandler } from "../../jobs/handlers/reward-credit.handler";

const hasDb = Boolean(process.env.DATABASE_URL);
const USER_ID = "jobs-test-user-0001";

async function cleanup() {
  await prisma.loyaltyLedger.deleteMany({ where: { userId: USER_ID } });
  await prisma.userWallet.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

describe.skipIf(!hasDb)("reward.credit on pg-boss (integration)", () => {
  const queue = createJobQueue({
    jobs,
    adapter: new PgBossAdapter({
      connectionString: process.env.DATABASE_URL as string,
      schema: "pgboss_test",
      pollIntervalSeconds: 0.5,
    }),
  });

  beforeAll(async () => {
    await cleanup();
    await queue.start();
  });

  afterAll(async () => {
    await queue.stop();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS pgboss_test CASCADE`);
    await cleanup();
  });

  it("does not create a job when the surrounding transaction rolls back", async () => {
    const orderId = `rb_${Date.now()}`;
    const payload = { userId: USER_ID, razorpayOrderId: orderId, razorpayPaymentId: "p", ciPoints: 1, cashbackRupees: 0 };
    await expect(
      prisma.$transaction(async (tx) => {
        await queue.enqueue("reward.credit", payload, { tx, key: orderId });
        throw new Error("order insert failed");
      })
    ).rejects.toThrow("order insert failed");

    // Same key is still free → the rolled-back job never existed.
    const id = await queue.enqueue("reward.credit", { ...payload, ciPoints: 0 }, { key: orderId });
    expect(id).toBeTruthy();
  });

  it("commits with the transaction, dedupes, and credits the wallet exactly once", async () => {
    const orderId = `order_jobs_${Date.now()}`;
    const payload = { userId: USER_ID, razorpayOrderId: orderId, razorpayPaymentId: "pay_x", ciPoints: 42, cashbackRupees: 7 };

    const id1 = await prisma.$transaction((tx) => queue.enqueue("reward.credit", payload, { tx, key: orderId }));
    expect(id1).toBeTruthy();
    expect(await queue.enqueue("reward.credit", payload, { key: orderId })).toBeNull();

    await queue.work("reward.credit", rewardCreditHandler);
    await expect
      .poll(async () => (await prisma.userWallet.findUnique({ where: { userId: USER_ID } }))?.cashPaise, { timeout: 15_000 })
      .toBe(700);

    // Simulated at-least-once redelivery must not double-credit.
    await rewardCreditHandler(payload, { id: "redeliver", name: "reward.credit", attempt: 2 });

    const wallet = await prisma.userWallet.findUnique({ where: { userId: USER_ID } });
    expect(wallet?.ciPoints).toBe(42);
    expect(wallet?.cashPaise).toBe(700);
    const ledger = await prisma.loyaltyLedger.findMany({ where: { userId: USER_ID, orderId } });
    expect(ledger.map((l) => l.idempotencyKey).sort()).toEqual([`EARN_CASHBACK:${orderId}`, `EARN_ORDER:${orderId}`]);
  });
});
