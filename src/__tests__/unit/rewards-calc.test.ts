import { describe, it, expect } from "vitest";
import { RewardsCalcService } from "../../services/rewardsCalc.service";

describe("RewardsCalcService - Unified Calculation Engine", () => {
  describe("1. Cikka Pay Bill Payment Cashback Tiers", () => {
    it("offers ₹2 cashback for payments < ₹100", () => {
      const res50 = RewardsCalcService.calculateBillPaymentRewards(50);
      expect(res50.cashbackEarned).toBe(2);
      expect(res50.cashbackRange).toEqual([2, 2]);
      expect(res50.ciPointsEarned).toBe(5); // 1 pt per ₹10

      const res99 = RewardsCalcService.calculateBillPaymentRewards(99);
      expect(res99.cashbackEarned).toBe(2);
    });

    it("offers ₹4-₹6 (default ₹5) for ₹100 to ₹500", () => {
      const res100 = RewardsCalcService.calculateBillPaymentRewards(100);
      expect(res100.cashbackEarned).toBe(5);
      expect(res100.cashbackRange).toEqual([4, 6]);

      const res500 = RewardsCalcService.calculateBillPaymentRewards(500);
      expect(res500.cashbackEarned).toBe(5);
      expect(res500.ciPointsEarned).toBe(50);
    });

    it("offers ₹10-₹11 (default ₹10) for ₹500 to ₹3,500", () => {
      const res1500 = RewardsCalcService.calculateBillPaymentRewards(1500);
      expect(res1500.cashbackEarned).toBe(10);
      expect(res1500.cashbackRange).toEqual([10, 11]);
      expect(res1500.ciPointsEarned).toBe(150);
    });

    it("offers ₹15-₹16 (default ₹15) for ₹3,500 to ₹10,000", () => {
      const res5000 = RewardsCalcService.calculateBillPaymentRewards(5000);
      expect(res5000.cashbackEarned).toBe(15);
      expect(res5000.cashbackRange).toEqual([15, 16]);
      expect(res5000.ciPointsEarned).toBe(500);
    });

    it("offers ₹17-₹18 (default ₹17) for ₹10,000 to ₹50,000", () => {
      const res25000 = RewardsCalcService.calculateBillPaymentRewards(25000);
      expect(res25000.cashbackEarned).toBe(17);
      expect(res25000.cashbackRange).toEqual([17, 18]);
      expect(res25000.ciPointsEarned).toBe(2500);
      expect(res25000.tier).toBe("PREMIUM");
    });

    it("offers ₹19-₹20 (default ₹19) for ₹50,000 to ₹100,000", () => {
      const res75000 = RewardsCalcService.calculateBillPaymentRewards(75000);
      expect(res75000.cashbackEarned).toBe(19);
      expect(res75000.cashbackRange).toEqual([19, 20]);
      expect(res75000.ciPointsEarned).toBe(7500);
      expect(res75000.tier).toBe("VIP");
    });

    it("offers ₹22 flat for > ₹100,000", () => {
      const res150000 = RewardsCalcService.calculateBillPaymentRewards(150000);
      expect(res150000.cashbackEarned).toBe(22);
      expect(res150000.cashbackRange).toEqual([22, 22]);
      expect(res150000.ciPointsEarned).toBe(15000);
      expect(res150000.tier).toBe("VIP");
    });
  });

  describe("2. Cikka Mall Cashback Tiers & Special Sellers Multiplier", () => {
    it("≤ ₹100 product offers ₹1-₹2 (default ₹2), doubled to ₹4 for special seller", () => {
      const standard = RewardsCalcService.calculateMallPurchaseRewards(80, false);
      expect(standard.cashbackEarned).toBe(2);
      expect(standard.cashbackRange).toEqual([1, 2]);

      const special = RewardsCalcService.calculateMallPurchaseRewards(80, true);
      expect(special.cashbackEarned).toBe(4);
      expect(special.cashbackRange).toEqual([2, 4]);
      expect(special.isSpecialSeller).toBe(true);
    });

    it("₹100 to ₹500 product offers ₹6-₹8 (default ₹7), doubled to ₹14 for special seller", () => {
      const standard = RewardsCalcService.calculateMallPurchaseRewards(350, false);
      expect(standard.cashbackEarned).toBe(7);
      expect(standard.cashbackRange).toEqual([6, 8]);

      const special = RewardsCalcService.calculateMallPurchaseRewards(350, true);
      expect(special.cashbackEarned).toBe(14);
      expect(special.cashbackRange).toEqual([12, 16]);
    });

    it("₹500 to ₹2,000 product offers ₹10-₹15 (default ₹12), doubled to ₹24 for special seller", () => {
      const standard = RewardsCalcService.calculateMallPurchaseRewards(1200, false);
      expect(standard.cashbackEarned).toBe(12);
      expect(standard.cashbackRange).toEqual([10, 15]);

      const special = RewardsCalcService.calculateMallPurchaseRewards(1200, true);
      expect(special.cashbackEarned).toBe(24);
      expect(special.cashbackRange).toEqual([20, 30]);
    });

    it("₹2,000 to ₹5,000 product offers ₹17-₹25 (default ₹21), doubled to ₹42 for special seller", () => {
      const standard = RewardsCalcService.calculateMallPurchaseRewards(4000, false);
      expect(standard.cashbackEarned).toBe(21);
      expect(standard.cashbackRange).toEqual([17, 25]);

      const special = RewardsCalcService.calculateMallPurchaseRewards(4000, true);
      expect(special.cashbackEarned).toBe(42);
      expect(special.cashbackRange).toEqual([34, 50]);
    });

    it("₹5,000 to ₹15,000+ product offers ₹30 flat, doubled to ₹60 for special seller", () => {
      const standard = RewardsCalcService.calculateMallPurchaseRewards(8500, false);
      expect(standard.cashbackEarned).toBe(30);
      expect(standard.cashbackRange).toEqual([30, 30]);

      const special = RewardsCalcService.calculateMallPurchaseRewards(8500, true);
      expect(special.cashbackEarned).toBe(60);
      expect(special.cashbackRange).toEqual([60, 60]);
    });
  });

  describe("3. Reward Store Redemption Billing & Zero Rewards Rule", () => {
    it("standard delivery charges ₹11.79 platform fee with 0 cashback and 0 points earned", () => {
      const standard = RewardsCalcService.calculateRewardsStoreRedemption(2500, 2500, false);
      expect(standard.productValue).toBe(2500);
      expect(standard.pointsBurned).toBe(2500);
      expect(standard.cashbackEarned).toBe(0);
      expect(standard.ciPointsEarned).toBe(0);
      expect(standard.customerPlatformFee).toBe(9.99);
      expect(standard.customerPlatformFeeGst).toBe(1.80);
      expect(standard.expressDeliveryFee).toBe(0);
      expect(standard.totalPayableByCustomer).toBe(11.79);
    });

    it("express delivery adds ₹50.00 surcharge making total payable ₹61.79", () => {
      const express = RewardsCalcService.calculateRewardsStoreRedemption(5000, 5000, true);
      expect(express.productValue).toBe(5000);
      expect(express.pointsBurned).toBe(5000);
      expect(express.isExpress).toBe(true);
      expect(express.expressDeliveryFee).toBe(50);
      expect(express.totalPayableByCustomer).toBe(61.79);
    });

    it("exact custom points required are deducted", () => {
      const custom = RewardsCalcService.calculateRewardsStoreRedemption(1500, 1850, false);
      expect(custom.pointsBurned).toBe(1850);
      expect(custom.totalPayableByCustomer).toBe(11.79);
    });
  });
});
