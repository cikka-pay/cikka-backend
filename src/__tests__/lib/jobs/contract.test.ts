/**
 * Runs the adapter contract against every adapter we ship.
 * A new provider (NATS, SQS, BullMQ, …) gets one more line here.
 */
import { afterAll } from "vitest";
import { runAdapterContract } from "../../../lib/jobs/testing/contract";
import { MemoryAdapter } from "../../../lib/jobs/adapters/memory";
import { PgBossAdapter } from "../../../lib/jobs/adapters/pgboss";
import { prisma } from "../../../config/prisma";

runAdapterContract("memory", () => new MemoryAdapter({ pollMs: 5 }), { delaySeconds: 1 });

const hasDb = Boolean(process.env.DATABASE_URL);
runAdapterContract(
  "pg-boss",
  () =>
    new PgBossAdapter({
      connectionString: process.env.DATABASE_URL as string,
      schema: "pgboss_contract",
      pollIntervalSeconds: 0.5,
    }),
  { delaySeconds: 2, timeoutMs: 20_000 },
  hasDb
);

afterAll(async () => {
  if (hasDb) await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS pgboss_contract CASCADE`);
});
