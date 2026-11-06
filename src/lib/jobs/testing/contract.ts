/**
 * Adapter contract suite. Every provider adapter must pass this — it is what
 * makes switching providers safe. Usage in a test file:
 *
 *   runAdapterContract("pg-boss", () => new PgBossAdapter({ ... }));
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { JobPolicy, JobQueueAdapter, RawJob } from "../core/types";

export interface ContractOptions {
  /** How long to wait for async effects before failing, ms. */
  timeoutMs?: number;
  /** Delay used for the "delayed job" check, seconds. Must be > adapter poll interval. */
  delaySeconds?: number;
}

const policy = (over: Partial<JobPolicy> = {}): JobPolicy => ({
  retry: { limit: 2, delaySeconds: 0, backoff: false },
  timeoutSeconds: 60,
  concurrency: 1,
  deadLetter: true,
  ...over,
});

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`contract: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runAdapterContract(
  label: string,
  makeAdapter: () => JobQueueAdapter<any>,
  opts: ContractOptions = {},
  enabled = true
) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const delaySeconds = opts.delaySeconds ?? 3;
  const run = `${Date.now().toString(36)}`;
  const q = (n: string) => `contract-${run}-${n}`;

  describe.skipIf(!enabled)(`JobQueueAdapter contract: ${label}`, () => {
    let adapter: JobQueueAdapter<any>;

    beforeAll(async () => {
      adapter = makeAdapter();
      await adapter.start();
    });
    afterAll(async () => {
      await adapter.stop();
    });

    it("delivers the payload to a worker, first attempt = 1", async () => {
      const name = q("deliver");
      const seen: RawJob[] = [];
      await adapter.declareQueue(name, policy());
      await adapter.work(name, policy(), async (j) => void seen.push(j));
      const id = await adapter.send(name, { hello: "world", n: 1 }, {});
      expect(id).toBeTruthy();
      await waitFor(() => seen.length === 1, timeoutMs, "delivery");
      expect(seen[0]).toMatchObject({ id, name, payload: { hello: "world", n: 1 }, attempt: 1 });
    });

    it("dedupes by key: second send returns null and the handler runs once", async () => {
      const name = q("dedupe");
      let runs = 0;
      await adapter.declareQueue(name, policy());
      expect(await adapter.send(name, { v: 1 }, { dedupeKey: `${name}|k1` })).toBeTruthy();
      expect(await adapter.send(name, { v: 2 }, { dedupeKey: `${name}|k1` })).toBeNull();
      expect(await adapter.send(name, { v: 3 }, { dedupeKey: `${name}|k2` })).toBeTruthy();
      await adapter.work(name, policy(), async () => void runs++);
      await waitFor(() => runs === 2, timeoutMs, "two distinct keys");
      await sleep(500);
      expect(runs).toBe(2);
    });

    it("honours delaySeconds", async () => {
      const name = q("delay");
      let ranAt = 0;
      await adapter.declareQueue(name, policy());
      await adapter.work(name, policy(), async () => void (ranAt = Date.now()));
      const sentAt = Date.now();
      await adapter.send(name, {}, { delaySeconds });
      await waitFor(() => ranAt > 0, timeoutMs + delaySeconds * 1000, "delayed job");
      expect(ranAt - sentAt).toBeGreaterThanOrEqual(delaySeconds * 1000 - 250);
    });

    it("retries a failing handler with increasing attempt numbers", async () => {
      const name = q("retry");
      const attempts: number[] = [];
      await adapter.declareQueue(name, policy());
      await adapter.work(name, policy(), async (j) => {
        attempts.push(j.attempt);
        if (j.attempt < 3) throw new Error("transient");
      });
      await adapter.send(name, {}, {});
      await waitFor(() => attempts.length === 3, timeoutMs, "3 attempts");
      expect(attempts).toEqual([1, 2, 3]);
    });

    it("dead-letters a job after retries are exhausted", async () => {
      const name = q("dlq");
      const p = policy({ retry: { limit: 1, delaySeconds: 0, backoff: false } });
      let attempts = 0;
      const dead: RawJob[] = [];
      await adapter.declareQueue(name, p);
      await adapter.work(name, p, async () => {
        attempts++;
        throw new Error("permanent");
      });
      await adapter.work(`${name}.dlq`, policy({ deadLetter: false }), async (j) => void dead.push(j));
      await adapter.send(name, { order: "o-1" }, {});
      await waitFor(() => dead.length === 1, timeoutMs, "dead letter");
      expect(attempts).toBe(2);
      expect(dead[0].payload).toEqual({ order: "o-1" });
    });
  });
}
