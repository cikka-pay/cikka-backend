import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { createJobQueue, defineJob, defineJobs, JobPayloadError, type PayloadOf } from "../../../lib/jobs";
import { MemoryAdapter } from "../../../lib/jobs/adapters/memory";

const jobs = defineJobs({
  "email.send": defineJob({
    schema: z.object({ to: z.string().email(), template: z.enum(["welcome", "receipt"]) }),
    retry: { limit: 1, delaySeconds: 0, backoff: false },
  }),
  "points.expire": defineJob({ schema: z.object({ userId: z.string() }) }),
});

describe("createJobQueue (typed facade)", () => {
  let adapter: MemoryAdapter;
  let queue: ReturnType<typeof createJobQueue<typeof jobs, never>>;

  beforeEach(async () => {
    adapter = new MemoryAdapter({ timeScale: 0.01, pollMs: 2 });
    queue = createJobQueue({ jobs, adapter });
    await queue.start();
  });
  afterEach(() => queue.stop());

  it("infers payload types from the schemas", () => {
    expectTypeOf<PayloadOf<typeof jobs, "email.send">>().toEqualTypeOf<{ to: string; template: "welcome" | "receipt" }>();
    expectTypeOf(queue.enqueue).parameter(0).toEqualTypeOf<"email.send" | "points.expire">();

    // Compile-time guards (checked by tsc via vitest typecheck / editor):
    // @ts-expect-error unknown job name
    void (() => queue.enqueue("nope", {}));
    // @ts-expect-error wrong payload shape
    void (() => queue.enqueue("points.expire", { user: "x" }));
    // @ts-expect-error memory adapter cannot join a transaction (TTx = never)
    void (() => queue.enqueue("points.expire", { userId: "u" }, { tx: {} }));
  });

  it("delivers a typed payload to the handler", async () => {
    const got: Array<{ to: string; attempt: number }> = [];
    await queue.work("email.send", async (p, ctx) => void got.push({ to: p.to, attempt: ctx.attempt }));
    await queue.enqueue("email.send", { to: "a@b.co", template: "welcome" });
    await expect.poll(() => got).toEqual([{ to: "a@b.co", attempt: 1 }]);
  });

  it("rejects an invalid payload at enqueue time", async () => {
    await expect(
      queue.enqueue("email.send", { to: "not-an-email", template: "welcome" })
    ).rejects.toBeInstanceOf(JobPayloadError);
    expect(adapter.peek("email.send")).toHaveLength(0);
  });

  it("re-validates on consume: a malformed stored payload is dead-lettered, not handled", async () => {
    let handled = 0;
    await queue.work("email.send", async () => void handled++);
    // Simulate a payload written by an older/foreign producer, bypassing the facade.
    await adapter.send("email.send", { to: 42 }, {});
    await expect.poll(() => adapter.peek("email.send.dlq").length).toBe(1);
    expect(handled).toBe(0);
  });

  it("namespaces idempotency keys per job name", async () => {
    expect(await queue.enqueue("points.expire", { userId: "u" }, { key: "k" })).toBeTruthy();
    expect(await queue.enqueue("points.expire", { userId: "u" }, { key: "k" })).toBeNull();
    expect(await queue.enqueue("email.send", { to: "a@b.co", template: "receipt" }, { key: "k" })).toBeTruthy();
  });

  it("workAll registers every handler in the map", async () => {
    const seen: string[] = [];
    await queue.workAll({
      "email.send": async (p) => void seen.push(p.template),
      "points.expire": async (p) => void seen.push(p.userId),
    });
    await queue.enqueue("email.send", { to: "a@b.co", template: "receipt" });
    await queue.enqueue("points.expire", { userId: "u9" });
    await expect.poll(() => seen.sort()).toEqual(["receipt", "u9"]);
  });

  it("refuses to enqueue before start()", async () => {
    const q2 = createJobQueue({ jobs, adapter: new MemoryAdapter() });
    await expect(q2.enqueue("points.expire", { userId: "u" })).rejects.toThrow(/not started/);
  });

  it("reserves the .dlq suffix", () => {
    expect(() => defineJobs({ "x.dlq": defineJob({ schema: z.object({}) }) })).toThrow(/reserved/);
  });
});

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("library boundary", () => {
  it("src/lib/jobs imports nothing from the app (so it can become its own package)", () => {
    const root = resolve(__dirname, "../../../lib/jobs");
    const files: string[] = [];
    const walk = (d: string) =>
      readdirSync(d).forEach((f) => {
        const p = join(d, f);
        statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p);
      });
    walk(root);

    const allowedBare = new Set(["crypto", "pg-boss", "vitest"]);
    const offenders: string[] = [];
    for (const file of files) {
      for (const [, spec] of stripComments(readFileSync(file, "utf8")).matchAll(/from\s+"([^"]+)"/g)) {
        if (spec.startsWith(".")) {
          if (!resolve(file, "..", spec).startsWith(root)) offenders.push(`${file}: ${spec}`);
        } else if (!allowedBare.has(spec)) {
          offenders.push(`${file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
