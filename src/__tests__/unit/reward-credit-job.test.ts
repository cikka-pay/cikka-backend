import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/wallet.service", () => ({
  walletService: { creditPoints: vi.fn(), creditCash: vi.fn() },
}));
vi.mock("../../jobs", () => ({ jobQueue: { enqueue: vi.fn() } }));

import { walletService } from "../../services/wallet.service";
import { jobQueue } from "../../jobs";
import { rewardCreditHandler } from "../../jobs/handlers/reward-credit.handler";
import { enqueueMallRewardCredit } from "../../controllers/payment.controller";

const ctx = { id: "job-1", name: "reward.credit" as const, attempt: 1 };

describe("reward.credit job handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("credits points and cashback with order-scoped idempotency keys", async () => {
    await rewardCreditHandler(
      { userId: "u1", razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", ciPoints: 420, cashbackRupees: 12 },
      ctx
    );
    expect(walletService.creditPoints).toHaveBeenCalledWith("u1", 420, "EARN_ORDER", expect.objectContaining({
      idempotencyKey: "EARN_ORDER:order_1",
      orderId: "order_1",
      razorpayPaymentId: "pay_1",
    }));
    expect(walletService.creditCash).toHaveBeenCalledWith("u1", 1200, "EARN_CASHBACK", expect.objectContaining({
      idempotencyKey: "EARN_CASHBACK:order_1",
    }));
  });

  it("skips zero amounts", async () => {
    await rewardCreditHandler(
      { userId: "u1", razorpayOrderId: "o", razorpayPaymentId: "p", ciPoints: 0, cashbackRupees: 0 },
      ctx
    );
    expect(walletService.creditPoints).not.toHaveBeenCalled();
    expect(walletService.creditCash).not.toHaveBeenCalled();
  });

  it("propagates wallet errors so the queue retries", async () => {
    vi.mocked(walletService.creditPoints).mockRejectedValueOnce(new Error("db down"));
    await expect(
      rewardCreditHandler(
        { userId: "u1", razorpayOrderId: "o", razorpayPaymentId: "p", ciPoints: 5, cashbackRupees: 0 },
        ctx
      )
    ).rejects.toThrow("db down");
  });
});

describe("enqueueMallRewardCredit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("enqueues with a per-order dedupe key for logged-in buyers", async () => {
    await enqueueMallRewardCredit("u1", "order_9", "pay_9", { ciPointsEarned: 50, cashbackEarned: 7 });
    expect(jobQueue.enqueue).toHaveBeenCalledWith(
      "reward.credit",
      { userId: "u1", razorpayOrderId: "order_9", razorpayPaymentId: "pay_9", ciPoints: 50, cashbackRupees: 7 },
      expect.objectContaining({ key: "order_9" })
    );
  });

  it("does nothing for guest checkout", async () => {
    await enqueueMallRewardCredit(undefined, "o", "p", { ciPointsEarned: 50, cashbackEarned: 7 });
    expect(jobQueue.enqueue).not.toHaveBeenCalled();
  });

  it("never throws when enqueue fails (payment already captured)", async () => {
    vi.mocked(jobQueue.enqueue).mockRejectedValueOnce(new Error("queue down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(enqueueMallRewardCredit("u1", "o", "p", { ciPointsEarned: 1, cashbackEarned: 0 })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
