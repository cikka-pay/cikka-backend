import { describe, it, expect } from "vitest";
import { RewardsCalcService } from "../../services/rewardsCalc.service";

describe("RewardsCalcService - Unified Calculation Engine", () => {
  describe("1. Cikka Pay Bill Payment Cashback Tiers (11-Slab Matrix)", () => {
    it("Slab S1 (₹1 - ₹10): offers ₹0 cashback and 15 CI Points", () => {
      const res10 = RewardsCalcService.calculateBillPaymentRewards(10);
      expect(res10.slabId).toBe("S1");
      expect(res10.hasCashback).toBe(false);
      expect(res10.cashbackEarned).toBe(0);
      expect(res10.cashbackRange).toEqual([0, 0]);
      expect(res10.ciPointsEarned).toBe(15);
      expect(res10.tier).toBe("STANDARD");
    });

    it("Slab S2-S4 (₹11 - ₹1,000): scales across STANDARD cashback and CI Point slabs", () => {
      const res50 = RewardsCalcService.calculateBillPaymentRewards(50);
      expect(res50.slabId).toBe("S2");
      expect(res50.cashbackRange).toEqual([2, 5]);
      expect(res50.cashbackEarned).toBe(5);
      expect(res50.ciPointsEarned).toBe(15);

      const res100 = RewardsCalcService.calculateBillPaymentRewards(100);
      expect(res100.slabId).toBe("S3");
      expect(res100.cashbackRange).toEqual([5, 6]);
      expect(res100.cashbackEarned).toBe(6);
      expect(res100.ciPointsEarned).toBe(20);

      const res500 = RewardsCalcService.calculateBillPaymentRewards(500);
      expect(res500.slabId).toBe("S4");
      expect(res500.cashbackRange).toEqual([6, 8]);
      expect(res500.cashbackEarned).toBeGreaterThanOrEqual(6);
      expect(res500.cashbackEarned).toBeLessThanOrEqual(8);
      expect(res500.ciPointsRange).toEqual([45, 55]);
    });

    it("amounts with paise between slab boundaries still match a slab", () => {
      expect(RewardsCalcService.findSlab(10.5)?.id).toBe("S1");
      expect(RewardsCalcService.findSlab(50.4)?.id).toBe("S2");
      expect(RewardsCalcService.findSlab(100.99)?.id).toBe("S3");
      expect(RewardsCalcService.findSlab(1000.4)?.id).toBe("S4");
      expect(RewardsCalcService.findSlab(100000.5)?.id).toBe("S10");
      expect(RewardsCalcService.findSlab(11)?.id).toBe("S2");
      expect(RewardsCalcService.calculateBillPaymentRewards(50.5).ciPointsEarned).toBeGreaterThan(0);
    });

    it("Slab S5 (₹1,001 - ₹5,000): supports ₹4,300 benchmark and deterministic seeded PRNG", () => {
      const res4300 = RewardsCalcService.calculateBillPaymentRewards(4300);
      expect(res4300.slabId).toBe("S5");
      expect(res4300.cashbackEarned).toBe(10);
      expect(res4300.ciPointsEarned).toBe(68);
      expect(res4300.cashbackRange).toEqual([10, 11]);
      expect(res4300.ciPointsRange).toEqual([60, 75]);

      const seededA = RewardsCalcService.calculateCikkaPayRewards("pay_test_123", 1500);
      const seededB = RewardsCalcService.calculateCikkaPayRewards("pay_test_123", 1500);
      expect(seededA).toEqual(seededB);
      expect(seededA.cashbackEarned).toBeGreaterThanOrEqual(10);
      expect(seededA.cashbackEarned).toBeLessThanOrEqual(11);
    });

    it("Slab S6-S7 (₹5,001 - ₹25,000): PREMIUM tier", () => {
      const res5000 = RewardsCalcService.calculateBillPaymentRewards(5000);
      expect(res5000.slabId).toBe("S5");
      expect(res5000.cashbackEarned).toBe(11);

      const res25000 = RewardsCalcService.calculateBillPaymentRewards(25000);
      expect(res25000.slabId).toBe("S7");
      expect(res25000.cashbackRange).toEqual([16, 18]);
      expect(res25000.cashbackEarned).toBe(18);
      expect(res25000.ciPointsRange).toEqual([180, 240]);
      expect(res25000.ciPointsEarned).toBe(240);
      expect(res25000.tier).toBe("PREMIUM");
    });

    it("Slab S8-S11 (₹25,001 - >₹1,00,000): VIP and ELITE tiers", () => {
      const res75000 = RewardsCalcService.calculateBillPaymentRewards(75000);
      expect(res75000.slabId).toBe("S9");
      expect(res75000.cashbackRange).toEqual([23, 30]);
      expect(res75000.cashbackEarned).toBe(30);
      expect(res75000.ciPointsRange).toEqual([310, 330]);
      expect(res75000.ciPointsEarned).toBe(330);
      expect(res75000.tier).toBe("VIP");

      const res150000 = RewardsCalcService.calculateBillPaymentRewards(150000);
      expect(res150000.slabId).toBe("S11");
      expect(res150000.cashbackRange).toEqual([33, 34]);
      expect(res150000.cashbackEarned).toBe(34);
      expect(res150000.ciPointsRange).toEqual([360, 410]);
      expect(res150000.ciPointsEarned).toBe(410);
      expect(res150000.tier).toBe("ELITE");
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

  describe("4. Coupons & Brand Vouchers Valuation (6 CI Points = ₹1)", () => {
    it("enforces immutable 6 CI Points = ₹1 ratio for voucher redemptions and effective savings", () => {
      expect(RewardsCalcService.CI_POINTS_PER_RUPEE).toBe(6);
      expect(RewardsCalcService.COUPON_CI_POINTS_PER_RUPEE).toBe(6);

      const coupon100 = RewardsCalcService.calculateCouponTransaction({
        mode: "REDEMPTION",
        denomination: 100,
      });
      expect(coupon100.pointsBurned).toBe(600);
      expect(coupon100.cashbackEarned).toBe(0);
      expect(coupon100.ciPointsEarned).toBe(0);

      const coupon500 = RewardsCalcService.calculateCouponTransaction({
        mode: "REDEMPTION",
        denomination: 500,
      });
      expect(coupon500.pointsBurned).toBe(3000);

      const coupon1000 = RewardsCalcService.calculateCouponTransaction({
        mode: "REDEMPTION",
        denomination: 1000,
      });
      expect(coupon1000.pointsBurned).toBe(6000);

      // Verify Mall effectiveSavings converts earned CI Points to INR at 6 CI Points = ₹1
      const mall25k = RewardsCalcService.calculateMallPurchaseRewards(25000, false);
      expect(mall25k.ciPointsEarned).toBe(11000);
      expect(mall25k.effectiveSavings).toBe(mall25k.cashbackEarned + Math.round(11000 / 6));
    });
  });

  describe("5. Dual Calculator Mathematical Engine (CIKKA_FINANCIAL_LOGIC_SPEC Section 5)", () => {
    it("Mode 1: Target Product Value (V) -> Required CI Points (P) = ceil(quantize(6 * (1 - c) * V))", () => {
      // Coupon (c = 0)
      const couponPts = RewardsCalcService.calculateRewardProductPointsRequired(1000, 0);
      expect(couponPts).toBe(6000);

      // Normal Seller (c = 0.22): saves 22% points
      const normalPts = RewardsCalcService.calculateRewardProductPointsRequired(1000, 0.22);
      expect(normalPts).toBe(4680);

      // Special Seller (c = 0.42): saves 42% points
      const specialPts = RewardsCalcService.calculateRewardProductPointsRequired(1000, 0.42);
      expect(specialPts).toBe(3480);
    });

    it("Mode 2: Available CI Points Balance (P) -> Max Unlocked Product Value (V) in INR", () => {
      const p = 2040;

      // Brand Coupon (c = 0): 2040 / 6 = ₹340.00
      const couponVal = RewardsCalcService.calculatePointsPurchasingPower(p, 0);
      expect(couponVal).toBe(340.0);

      // Normal Seller (c = 0.22): 2040 / (6 * 0.78) = ₹435.89 (+28.2% boost)
      const normalVal = RewardsCalcService.calculatePointsPurchasingPower(p, 0.22);
      expect(normalVal).toBe(435.89);
      expect(RewardsCalcService.calculatePointsBoostPercentage(0.22)).toBe(28.2);

      // Special Seller (c = 0.42): 2040 / (6 * 0.58) = ₹586.20 (+72.4% boost)
      const specialVal = RewardsCalcService.calculatePointsPurchasingPower(p, 0.42);
      expect(specialVal).toBe(586.2);
      expect(RewardsCalcService.calculatePointsBoostPercentage(0.42)).toBe(72.4);
    });
  });

  describe("6. BBPS Utility Bill Payment Slabs (Section 6.2 Table)", () => {
    it("differentiates utility bill payment slabs from credit card slabs", () => {
      // ₹100 Utility Bill matches U1 (₹50 - ₹200)
      const util100 = RewardsCalcService.calculateBillPaymentRewards(100, undefined, true);
      expect(util100.slabId).toBe("U1");
      expect(util100.cashbackEarned).toBeGreaterThanOrEqual(3);
      expect(util100.cashbackEarned).toBeLessThanOrEqual(4);
      expect(util100.ciPointsEarned).toBeGreaterThanOrEqual(15);
      expect(util100.ciPointsEarned).toBeLessThanOrEqual(20);

      // ₹15,000 Utility Bill matches U10 (> ₹12,000)
      const util15k = RewardsCalcService.calculateBillPaymentRewards(15000, undefined, true);
      expect(util15k.slabId).toBe("U10");
      expect(util15k.cashbackEarned).toBe(15);
      expect(util15k.ciPointsEarned).toBeGreaterThanOrEqual(150);
      expect(util15k.ciPointsEarned).toBeLessThanOrEqual(220);
    });
  });

  describe("7. Escrow Split & Invariants (Section 4, 7, 8)", () => {
    it("computes exact X, Y, Z split on ₹1,000 product for normal seller (22% comm)", () => {
      const split = RewardsCalcService.computeRedemptionSplit(1000, 0.22);
      expect(split.productGsv).toBe(1000);
      expect(split.totalTicketY).toBe(1011.79);
      expect(split.sellerPayout).toBe(668.56);
      expect(split.courierPayout).toBe(64.90);
      expect(split.whatCikkaPaysZ).toBe(782.86);
      expect(split.cikkaEarningX).toBe(228.93);
      expect(split.netCashBurned).toBe(771.07);
      expect(split.pointsBurned).toBe(4680);
      expect(split.savingsVsCoupon).toBe(228.93);
      expect(split.invariantsVerified).toBe(true);
    });

    it("computes exact X, Y, Z split on ₹1,000 product for special seller (42% comm)", () => {
      const split = RewardsCalcService.computeRedemptionSplit(1000, 0.42);
      expect(split.productGsv).toBe(1000);
      expect(split.totalTicketY).toBe(1011.79);
      expect(split.sellerPayout).toBe(468.56);
      expect(split.courierPayout).toBe(64.90);
      expect(split.whatCikkaPaysZ).toBe(613.37);
      expect(split.cikkaEarningX).toBe(398.42);
      expect(split.netCashBurned).toBe(601.58);
      expect(split.pointsBurned).toBe(3480);
      expect(split.savingsVsCoupon).toBe(398.42);
      expect(split.invariantsVerified).toBe(true);
    });
  });
});
