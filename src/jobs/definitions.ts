/**
 * Cikka's job catalogue: every async job name, its payload schema and retry policy.
 * Add a job here, then a handler in ./handlers and register it in ./index.ts.
 * Payload types are inferred from the zod schemas — no hand-written interfaces.
 */
import { z } from "zod";
import { defineJob, defineJobs, type PayloadOf } from "../lib/jobs";

export const RewardCreditPayload = z.object({
  userId: z.string().min(1),
  /** Razorpay order id — business key for idempotency. */
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  ciPoints: z.number().int().nonnegative(),
  /** Cashback in rupees. */
  cashbackRupees: z.number().nonnegative(),
});

export const jobs = defineJobs({
  /** Credit Cikka Mall purchase rewards (CI Points + cashback) to the buyer's wallet. */
  "reward.credit": defineJob({
    schema: RewardCreditPayload,
    retry: { limit: 8, delaySeconds: 10, backoff: true, maxDelaySeconds: 3600 },
    timeoutSeconds: 300,
  }),
});

export type CikkaJobs = typeof jobs;
export type CikkaJobName = keyof CikkaJobs;
export type CikkaPayload<N extends CikkaJobName> = PayloadOf<CikkaJobs, N>;
