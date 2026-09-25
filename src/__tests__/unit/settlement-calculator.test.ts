import { describe, it, expect } from "vitest";
import {
  calculateSettlementBreakdown,
  DEFAULT_SETTLEMENT_CONFIG,
} from "../../services/settlementCalculator.service";

describe("Cikka Marketplace — Settlement Split & Accounting Unit Tests", () => {
  describe("Mandatory Reference Test Cases (Specification Section 9)", () => {
    it("Case 1: ₹1,000 Product", () => {
      const result = calculateSettlementBreakdown(1000);

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
      expect(result.sellerNetSettlement).toBe(516.02);
      expect(result.cikkaFeeRevenue).toBe(231.43);
    });

    it("Case 2: ₹5,000 Product", () => {
      const result = calculateSettlementBreakdown(5000);

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
      expect(result.sellerNetSettlement).toBe(2910.50);
      expect(result.cikkaFeeRevenue).toBe(1057.19);
    });

    it("Case 3: ₹10,000 Product", () => {
      const result = calculateSettlementBreakdown(10000);

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
      expect(result.sellerNetSettlement).toBe(5903.60);
      expect(result.cikkaFeeRevenue).toBe(2089.40);
    });
  });

  describe("Configuration & Overrides", () => {
    it("should allow custom commission rate override (e.g. 15% category rate)", () => {
      const result = calculateSettlementBreakdown(1000, { commissionRate: 15 });
      // Base = 847.46
      // Commission = 847.4576 * 0.15 = 127.12
      // Commission GST = 127.1186 * 0.18 = 22.88
      // Commission Total = 150.00
      expect(result.commissionTotal).toBe(150.00);
      expect(result.commissionRate).toBe(15);
      // Net will be higher by ₹70 (220 - 150)
      expect(result.sellerNetSettlement).toBe(586.02);
    });

    it("should handle zero or negative product value safely", () => {
      const result = calculateSettlementBreakdown(0);
      expect(result.sellerNetSettlement).toBe(0);
      expect(result.baseProductValue).toBe(0);
      expect(result.grossProductValue).toBe(0);
    });
  });
});
