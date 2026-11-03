import { describe, it, expect, vi } from "vitest";
import { RewardsCalcService } from "../../services/rewardsCalc.service";
import { walletService } from "../../services/wallet.service";
import { WalletTxType } from "../../generated/prisma/client";
import { prisma } from "../../config/prisma";

describe("Financial Ledger, Rewards & Security Guard Verification", () => {
  describe("1. RewardsCalcService Mathematical Precision", () => {
    it("should calculate correct tiered cashback and CI points for bill payments", () => {
      // < 100: Rs 2, 1 pt per Rs 10
      const r50 = RewardsCalcService.calculateBillPaymentRewards(50);
      expect(r50.cashbackEarned).toBe(2);
      expect(r50.ciPointsEarned).toBe(5);

      // 500 - 3500: Rs 10, 1 pt per Rs 10
      const r1500 = RewardsCalcService.calculateBillPaymentRewards(1500);
      expect(r1500.cashbackEarned).toBe(10);
      expect(r1500.ciPointsEarned).toBe(150);

      // > 100,000: Rs 22, 1 pt per Rs 10
      const r150k = RewardsCalcService.calculateBillPaymentRewards(150000);
      expect(r150k.cashbackEarned).toBe(22);
      expect(r150k.ciPointsEarned).toBe(15000);
    });

    it("should calculate correct mall purchase rewards with 2x multiplier for special sellers", () => {
      // Standard seller Rs 1200: tier Rs 12, 2x for special seller = Rs 24
      const standard = RewardsCalcService.calculateMallPurchaseRewards(1200, false);
      expect(standard.cashbackEarned).toBe(12);

      const special = RewardsCalcService.calculateMallPurchaseRewards(1200, true);
      expect(special.cashbackEarned).toBe(24);
      expect(special.cashbackMultiplier).toBe(2);
    });
  });

  describe("2. Double-Entry Wallet Safety Invariants", () => {
    it("should throw error when both pointsDelta and cashPaiseDelta are zero", async () => {
      await expect(
        walletService.applyEntry({
          userId: "usr-test-1",
          txType: WalletTxType.EARN_ORDER,
          pointsDelta: 0,
          cashPaiseDelta: 0,
        })
      ).rejects.toThrow("WalletService: Both pointsDelta and cashPaiseDelta are zero");
    });

    it("should reject negative credit arguments in convenience wrappers", async () => {
      await expect(
        walletService.creditPoints("usr-test-1", -100, WalletTxType.EARN_ORDER)
      ).rejects.toThrow("creditPoints: points must be > 0");

      await expect(
        walletService.creditCash("usr-test-1", -500, WalletTxType.EARN_CASHBACK)
      ).rejects.toThrow("creditCash: amountPaise must be > 0");
    });

    it("should prevent double-spending and reject debits exceeding available balance", async () => {
      // Mock prisma transaction to simulate a wallet with 100 points
      const mockPrisma = vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const fakeTx = {
          user: { upsert: vi.fn().mockResolvedValue({}) },
          userWallet: {
            upsert: vi.fn().mockResolvedValue({
              id: "w-1",
              userId: "usr-low-bal",
              ciPoints: 100,
              cashPaise: 0,
              version: 1,
            }),
          },
        };
        return callback(fakeTx);
      });

      await expect(
        walletService.debitPoints("usr-low-bal", 5000, WalletTxType.REDEEM_REWARD)
      ).rejects.toThrow(/Insufficient CI Points/);

      mockPrisma.mockRestore();
    });

    it("should enforce idempotency and avoid duplicate credits when key already exists", async () => {
      const mockFindUnique = vi.spyOn(prisma.loyaltyLedger, "findUnique").mockResolvedValue({
        id: "led-existing",
        balanceAfterPoints: 500,
        balanceAfterPaise: 2000,
      } as any);

      const result = await walletService.applyEntry({
        userId: "usr-test-idem",
        txType: WalletTxType.EARN_ORDER,
        pointsDelta: 100,
        idempotencyKey: "BBPS_PTS:CKK-12345",
      });

      expect(result.duplicate).toBe(true);
      expect(result.ledgerEntryId).toBe("led-existing");

      mockFindUnique.mockRestore();
    });
  });
});
