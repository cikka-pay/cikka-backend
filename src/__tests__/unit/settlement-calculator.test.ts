import { describe, it, expect } from "vitest";
import {
  calculateSettlementBreakdown,
  DEFAULT_SETTLEMENT_CONFIG,
} from "../../services/settlementCalculator.service";

describe("Cikka Marketplace — Settlement Split & Accounting Unit Tests", () => {
  describe("Authoritative Specification Benchmark Test Case", () => {
    it("Authoritative Case: ₹35,989.00 GSV with 3 orders", () => {
      const result = calculateSettlementBreakdown(35989, undefined, 3);

      // 1. Net Base Price (Exclusive of Product GST: GSV ÷ 1.18)
      expect(result.grossProductValue).toBe(35989.00);
      expect(result.baseProductValue).toBe(30499.15);
      expect(result.productGst).toBe(5489.85);

      // 2. Cikka Commission (22% of Net Base + 18% GST)
      expect(result.commissionRate).toBe(22.00);
      expect(result.commission).toBe(6709.81);
      expect(result.commissionGst).toBe(1207.77);
      expect(result.commissionTotal).toBe(7917.58);

      // 3. Shipping (₹55 × 3 orders + 18% GST)
      expect(result.shipping).toBe(165.00);
      expect(result.shippingGst).toBe(29.70);
      expect(result.shippingTotal).toBe(194.70);

      // 4. Success Charge (2% of GSV + 18% GST)
      expect(result.successFeeRate).toBe(2.00);
      expect(result.successFee).toBe(719.78);
      expect(result.successFeeGst).toBe(129.56);
      expect(result.successFeeTotal).toBe(849.34);

      // 5. Platform Fee (₹15 × 3 orders + 18% GST)
      expect(result.sellerPlatformFee).toBe(45.00);
      expect(result.sellerPlatformFeeGst).toBe(8.10);
      expect(result.sellerPlatformTotal).toBe(53.10);

      // 6. Statutory Taxes (TDS: 0.1% of GSV, TCS: 0.5% of Net Base)
      expect(result.tdsRate).toBe(0.10);
      expect(result.tds).toBe(35.99);
      expect(result.tcsRate).toBe(0.50);
      expect(result.tcs).toBe(152.50);

      // Total Deductions
      expect(result.totalSellerDeductions).toBe(9203.21);

      // 7. Final Net Payout = GSV - Total Deductions
      expect(result.sellerNetSettlement).toBe(26785.79);
    });
  });

  describe("Single Order Product References", () => {
    it("Case 1: ₹1,000 Product (1 order)", () => {
      const result = calculateSettlementBreakdown(1000, undefined, 1);

      // 1. Base Product Value
      expect(result.baseProductValue).toBe(847.46);
      expect(result.productGst).toBe(152.54);

      // 2. Charges Breakdown
      expect(result.commission).toBe(186.44);
      expect(result.commissionGst).toBe(33.56);
      expect(result.commissionTotal).toBe(220.00);

      expect(result.shipping).toBe(55.00);
      expect(result.shippingGst).toBe(9.90);
      expect(result.shippingTotal).toBe(64.90);

      expect(result.sellerPlatformFee).toBe(15.00);
      expect(result.sellerPlatformFeeGst).toBe(2.70);
      expect(result.sellerPlatformTotal).toBe(17.70);

      expect(result.tds).toBe(1.00);
      expect(result.tcs).toBe(4.24);

      expect(result.successFee).toBe(20.00);
      expect(result.successFeeGst).toBe(3.60);
      expect(result.successFeeTotal).toBe(23.60);

      expect(result.customerPlatformFee).toBe(9.99);
      expect(result.customerPlatformFeeGst).toBe(1.80);
      expect(result.customerPlatformTotal).toBe(11.79);
      expect(result.customerTotalPayment).toBe(1011.79);

      // 3. Final Outputs
      expect(result.totalSellerDeductions).toBe(331.44);
      expect(result.sellerNetSettlement).toBe(668.56);
      expect(result.cikkaFeeRevenue).toBe(231.43);
    });

    it("Case 2: ₹5,000 Product (1 order)", () => {
      const result = calculateSettlementBreakdown(5000, undefined, 1);

      // 1. Base Product Value
      expect(result.baseProductValue).toBe(4237.29);

      // 2. Charges Breakdown
      expect(result.commissionTotal).toBe(1100.00);
      expect(result.shippingTotal).toBe(64.90);
      expect(result.sellerPlatformTotal).toBe(17.70);
      expect(result.tds).toBe(5.00);
      expect(result.tcs).toBe(21.19);
      expect(result.successFeeTotal).toBe(118.00);

      // 3. Final Outputs
      expect(result.totalSellerDeductions).toBe(1326.79);
      expect(result.sellerNetSettlement).toBe(3673.21);
      expect(result.cikkaFeeRevenue).toBe(1057.19);
    });

    it("Case 3: ₹10,000 Product (1 order)", () => {
      const result = calculateSettlementBreakdown(10000, undefined, 1);

      // 1. Base Product Value
      expect(result.baseProductValue).toBe(8474.58);

      // 2. Charges Breakdown
      expect(result.commissionTotal).toBe(2200.00);
      expect(result.shippingTotal).toBe(64.90);
      expect(result.sellerPlatformTotal).toBe(17.70);
      expect(result.tds).toBe(10.00);
      expect(result.tcs).toBe(42.37);
      expect(result.successFeeTotal).toBe(236.00);

      // 3. Final Outputs
      expect(result.totalSellerDeductions).toBe(2570.97);
      expect(result.sellerNetSettlement).toBe(7429.03);
      expect(result.cikkaFeeRevenue).toBe(2089.40);
    });
  });

  describe("Configuration & Overrides", () => {
    it("should allow custom commission rate override (e.g. 15% category rate)", () => {
      const result = calculateSettlementBreakdown(1000, { commissionRate: 15 }, 1);
      // Base = 847.46
      // Commission = 847.46 * 0.15 = 127.12
      // Commission GST = 127.12 * 0.18 = 22.88
      // Commission Total = 150.00
      expect(result.commissionTotal).toBe(150.00);
      expect(result.commissionRate).toBe(15);
      expect(result.sellerNetSettlement).toBe(738.56);
    });

    it("should dynamically recalculate shipping & platform fees when orders count changes", () => {
      const result1 = calculateSettlementBreakdown(35989, undefined, 1);
      const result3 = calculateSettlementBreakdown(35989, undefined, 3);
      const result5 = calculateSettlementBreakdown(35989, undefined, 5);

      // 1 order shipping: 55 + 9.90 = 64.90, platform: 15 + 2.70 = 17.70
      expect(result1.shippingTotal).toBe(64.90);
      expect(result1.sellerPlatformTotal).toBe(17.70);

      // 3 orders shipping: 165 + 29.70 = 194.70, platform: 45 + 8.10 = 53.10
      expect(result3.shippingTotal).toBe(194.70);
      expect(result3.sellerPlatformTotal).toBe(53.10);

      // 5 orders shipping: 275 + 49.50 = 324.50, platform: 75 + 13.50 = 88.50
      expect(result5.shippingTotal).toBe(324.50);
      expect(result5.sellerPlatformTotal).toBe(88.50);

      // Final payout differs by order fees
      expect(result3.sellerNetSettlement).toBe(26785.79);
      expect(result1.sellerNetSettlement).toBeGreaterThan(result3.sellerNetSettlement);
      expect(result5.sellerNetSettlement).toBeLessThan(result3.sellerNetSettlement);
    });

    it("should handle zero or negative product value safely", () => {
      const result = calculateSettlementBreakdown(0);
      expect(result.sellerNetSettlement).toBe(0);
      expect(result.baseProductValue).toBe(0);
      expect(result.grossProductValue).toBe(0);
    });
  });
});
