/**
 * Cikka Platform — Unified Rewards, Cashback & CI Points Calculation Engine
 * 
 * CORE RULES:
 * 1. NO CASHBACK or CI Points are ever awarded on Rewards Store product redemptions/purchases.
 *    Rewards Store is strictly a points-burning channel.
 * 2. Rewards (both Cashback and CI Points) are EXCLUSIVELY offered for:
 *    a) Bill payment transactions through Cikka Pay (Credit Card & BBPS utility bills)
 *    b) Cikka Mall direct product purchases (E-Commerce checkouts paid with money)
 * 3. Products & Coupons Logic:
 *    - Cikka Mall Products: Earn direct cashback (1.5% - 3%) and CI Points (10x - 45x tiered).
 *    - Rewards Store Products: 100% points redemption burn (e.g. 1 CI Point = ₹1 face value).
 *    - Coupons / Brand Vouchers:
 *        • Redeemed via CI Points (Hubble): 1 CI Point = ₹1 face value. Zero cashback, Zero points earned.
 *        • Purchased via Cikka Pay: Brand discount (1% - 5%) + CI points earned on net payable.
 */

export interface MallProductRewards {
  orderAmount: number;
  cashbackEarned: number;
  ciPointsEarned: number;
  effectiveSavings: number;
  status: "PENDING_DELIVERY_WINDOW";
}

export interface BillPaymentRewards {
  billAmount: number;
  cashbackEarned: number;
  ciPointsEarned: number;
  tier: "STANDARD" | "PREMIUM" | "VIP";
}

export interface RewardsStoreRedemptionResult {
  productValue: number;
  pointsBurned: number;
  cashbackEarned: 0;
  ciPointsEarned: 0;
  customerPlatformFee: number;
  customerPlatformFeeGst: number;
  totalPayableByCustomer: number;
}

export interface CouponRewardResult {
  type: "REDEMPTION" | "PURCHASE";
  denomination: number;
  pointsBurned: number;
  cashbackEarned: number;
  ciPointsEarned: number;
  brandDiscount: number;
  netPayable: number;
}

export class RewardsCalcService {
  /**
   * 1. CIKKA MALL PRODUCT PURCHASE
   * Calculates Cashback and CI Points earned when a member buys items with real money.
   * - Cashback: ~1.5% base cashback credited to Cikka Wallet (capped appropriately).
   * - CI Points: Tiered multiplier based on order value:
   *     • ≥ ₹100,000: 48% rate
   *     • ≥ ₹40,000:  46% rate
   *     • ≥ ₹15,000:  44% rate
   *     • < ₹15,000:  42% rate
   */
  static calculateMallPurchaseRewards(orderAmount: number): MallProductRewards {
    const total = Math.max(0, Number(orderAmount) || 0);

    // 1.5% Direct Cashback (min ₹20, max ₹2,500 per order)
    const rawCashback = Math.round(total * 0.015);
    const cashbackEarned = total > 0 ? Math.min(2500, Math.max(20, rawCashback)) : 0;

    // Tiered CI Points multiplier
    let rate = 0.42;
    if (total >= 100000) {
      rate = 0.48;
    } else if (total >= 40000) {
      rate = 0.46;
    } else if (total >= 15000) {
      rate = 0.44;
    }

    const ciPointsEarned = Math.round(total * rate);

    return {
      orderAmount: total,
      cashbackEarned,
      ciPointsEarned,
      effectiveSavings: cashbackEarned + Math.round(ciPointsEarned * 0.25),
      status: "PENDING_DELIVERY_WINDOW",
    };
  }

  /**
   * 2. CIKKA PAY BILL PAYMENT (Credit Card & BBPS Utility Bills)
   * Calculates Cashback and CI Points for bill settlement transactions.
   * - Cashback: 0.25% instant cashback (min ₹15, max ₹100 per transaction).
   * - CI Points: 1 CI Point per ₹10 of bill amount (10% rate, e.g. ₹28,450 bill = 2,845 CI Points).
   */
  static calculateBillPaymentRewards(billAmount: number): BillPaymentRewards {
    const total = Math.max(0, Number(billAmount) || 0);

    // 0.25% instant cashback
    const rawCashback = Math.round(total * 0.0025);
    const cashbackEarned = total > 0 ? Math.min(100, Math.max(15, rawCashback)) : 0;

    // 1 CI Point per ₹10 paid
    const ciPointsEarned = Math.round(total * 0.1);

    let tier: "STANDARD" | "PREMIUM" | "VIP" = "STANDARD";
    if (total >= 50000) tier = "VIP";
    else if (total >= 20000) tier = "PREMIUM";

    return {
      billAmount: total,
      cashbackEarned,
      ciPointsEarned,
      tier,
    };
  }

  /**
   * 3. REWARDS STORE PRODUCT REDEMPTION
   * STRICT POLICY: ZERO CASHBACK and ZERO CI POINTS EARNED.
   * Product value is sponsored 100% by Cikka Corporate Treasury against burned CI Points.
   * Customer pays only Customer Platform Fee (₹9.99 + 18% GST = ₹11.79).
   */
  static calculateRewardsStoreRedemption(
    productValue: number,
    customPointsRequired?: number
  ): RewardsStoreRedemptionResult {
    const val = Math.max(0, Number(productValue) || 1000);
    // Standard conversion: 1 CI Point = ₹1 face value (unless custom specified)
    const pointsBurned = customPointsRequired !== undefined && customPointsRequired > 0
      ? Number(customPointsRequired)
      : val;

    const customerPlatformFee = 9.99;
    const customerPlatformFeeGst = 1.8;
    const totalPayableByCustomer = 11.79;

    return {
      productValue: val,
      pointsBurned,
      cashbackEarned: 0, // Strict rule: No cashback on rewards store redemptions
      ciPointsEarned: 0, // Strict rule: No new points generated on rewards burn
      customerPlatformFee,
      customerPlatformFeeGst,
      totalPayableByCustomer,
    };
  }

  /**
   * 4. COUPONS & BRAND VOUCHERS (Hubble Integration)
   * Mode A: Points Redemption -> Member burns CI points (1 pt = ₹1 voucher). ZERO cashback, ZERO points.
   * Mode B: Cash/UPI Purchase -> Member gets Brand Discount (1%-5%) + earns CI points on net paid.
   */
  static calculateCouponTransaction(params: {
    mode: "REDEMPTION" | "PURCHASE";
    denomination: number;
    brandDiscountPercent?: number;
  }): CouponRewardResult {
    const denom = Math.max(0, Number(params.denomination) || 0);

    if (params.mode === "REDEMPTION") {
      // Free voucher via CI Points burn: 0 cashback, 0 points earned
      return {
        type: "REDEMPTION",
        denomination: denom,
        pointsBurned: denom, // 1 CI Point = ₹1 Face Value
        cashbackEarned: 0,
        ciPointsEarned: 0,
        brandDiscount: 0,
        netPayable: 0,
      };
    } else {
      // Real-money voucher purchase via Cikka Pay: Brand discount + CI Points
      const discPercent = params.brandDiscountPercent || 0;
      const brandDiscount = Math.round((denom * discPercent) / 100);
      const netPayable = Math.max(0, denom - brandDiscount);
      // Earn 10% in CI Points on net money paid
      const ciPointsEarned = Math.round(netPayable * 0.1);

      return {
        type: "PURCHASE",
        denomination: denom,
        pointsBurned: 0,
        cashbackEarned: 0, // Instant discount already passed to user
        ciPointsEarned,
        brandDiscount,
        netPayable,
      };
    }
  }
}
