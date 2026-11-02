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
  cashbackRange?: [number, number];
  isSpecialSeller?: boolean;
  cashbackMultiplier?: number;
  ciPointsEarned: number;
  effectiveSavings: number;
  status: "PENDING_DELIVERY_WINDOW";
}

export interface BillPaymentRewards {
  billAmount: number;
  cashbackEarned: number;
  cashbackRange?: [number, number];
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
  expressDeliveryFee: number;
  isExpress: boolean;
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
   * New Tiered Cashback Rules:
   *   • ≤ ₹100: ₹1 - ₹2 (default: ₹2)
   *   • ₹100 - ₹500: ₹6 - ₹8 (default: ₹7)
   *   • ₹500 - ₹2,000: ₹10 - ₹15 (default: ₹12)
   *   • ₹2,000 - ₹5,000: ₹17 - ₹25 (default: ₹21)
   *   • ₹5,000 - ₹15,000: ₹30 flat
   *   • > ₹15,000: ₹30 flat
   *
   * Special Sellers Rule:
   *   If user purchases from a special seller, cashback numbers are DOUBLED (2x).
   */
  static calculateMallPurchaseRewards(
    orderAmount: number,
    isSpecialSeller: boolean = false
  ): MallProductRewards {
    const total = Math.max(0, Number(orderAmount) || 0);
    if (total <= 0) {
      return {
        orderAmount: 0,
        cashbackEarned: 0,
        cashbackRange: [0, 0],
        isSpecialSeller: Boolean(isSpecialSeller),
        cashbackMultiplier: isSpecialSeller ? 2 : 1,
        ciPointsEarned: 0,
        effectiveSavings: 0,
        status: "PENDING_DELIVERY_WINDOW",
      };
    }

    let baseCashback = 2;
    let baseRange: [number, number] = [1, 2];

    if (total <= 100) {
      baseCashback = 2;
      baseRange = [1, 2];
    } else if (total <= 500) {
      baseCashback = 7;
      baseRange = [6, 8];
    } else if (total <= 2000) {
      baseCashback = 12;
      baseRange = [10, 15];
    } else if (total <= 5000) {
      baseCashback = 21;
      baseRange = [17, 25];
    } else {
      // ₹5,000 - ₹15,000+
      baseCashback = 30;
      baseRange = [30, 30];
    }

    const multiplier = isSpecialSeller ? 2 : 1;
    const finalCashback = baseCashback * multiplier;
    const finalRange: [number, number] = [
      baseRange[0] * multiplier,
      baseRange[1] * multiplier,
    ];

    // Tiered CI Points multiplier based on order value
    let ciRate = 0.42;
    if (total >= 100000) {
      ciRate = 0.48;
    } else if (total >= 40000) {
      ciRate = 0.46;
    } else if (total >= 15000) {
      ciRate = 0.44;
    }

    const ciPointsEarned = Math.round(total * ciRate);

    return {
      orderAmount: total,
      cashbackEarned: finalCashback,
      cashbackRange: finalRange,
      isSpecialSeller: Boolean(isSpecialSeller),
      cashbackMultiplier: multiplier,
      ciPointsEarned,
      effectiveSavings: finalCashback + Math.round(ciPointsEarned * 0.25),
      status: "PENDING_DELIVERY_WINDOW",
    };
  }

  /**
   * 2. CIKKA PAY BILL PAYMENT (Credit Card & BBPS Utility Bills)
   * New Tiered Cashback Rules:
   *   • < ₹100: ₹2 flat
   *   • ₹100 - ₹500: ₹4 - ₹6 (default: ₹5)
   *   • ₹500 - ₹3,500: ₹10 - ₹11 (default: ₹10)
   *   • ₹3,500 - ₹10,000: ₹15 - ₹16 (default: ₹15)
   *   • ₹10,000 - ₹50,000: ₹17 - ₹18 (default: ₹17)
   *   • ₹50,000 - ₹100,000: ₹19 - ₹20 (default: ₹19)
   *   • > ₹100,000: ₹22 flat
   *
   * CI Points: 1 CI Point per ₹10 of bill amount (10% rate).
   */
  static calculateBillPaymentRewards(billAmount: number): BillPaymentRewards {
    const total = Math.max(0, Number(billAmount) || 0);
    if (total <= 0) {
      return {
        billAmount: 0,
        cashbackEarned: 0,
        cashbackRange: [0, 0],
        ciPointsEarned: 0,
        tier: "STANDARD",
      };
    }

    let cashbackEarned = 2;
    let cashbackRange: [number, number] = [2, 2];

    if (total < 100) {
      cashbackEarned = 2;
      cashbackRange = [2, 2];
    } else if (total <= 500) {
      cashbackEarned = 5;
      cashbackRange = [4, 6];
    } else if (total <= 3500) {
      cashbackEarned = 10;
      cashbackRange = [10, 11];
    } else if (total <= 10000) {
      cashbackEarned = 15;
      cashbackRange = [15, 16];
    } else if (total <= 50000) {
      cashbackEarned = 17;
      cashbackRange = [17, 18];
    } else if (total <= 100000) {
      cashbackEarned = 19;
      cashbackRange = [19, 20];
    } else {
      // > ₹100,000
      cashbackEarned = 22;
      cashbackRange = [22, 22];
    }

    // 1 CI Point per ₹10 paid (10% standard rate)
    const ciPointsEarned = Math.round(total * 0.1);

    let tier: "STANDARD" | "PREMIUM" | "VIP" = "STANDARD";
    if (total >= 50000) tier = "VIP";
    else if (total >= 20000) tier = "PREMIUM";

    return {
      billAmount: total,
      cashbackEarned,
      cashbackRange,
      ciPointsEarned,
      tier,
    };
  }

  /**
   * 3. REWARDS STORE PRODUCT REDEMPTION
   * STRICT POLICY: ZERO CASHBACK and ZERO CI POINTS EARNED.
   * Product value is sponsored 100% by Cikka Corporate Treasury against burned CI Points.
   * Customer fees:
   *   • Standard Delivery: Customer Platform Fee (₹9.99 + 18% GST = ₹11.79)
   *   • Express 2-Day Delivery: ₹50.00 Express Fee + ₹11.79 Platform Fee = ₹61.79
   * All customer fee revenue (₹11.79 or ₹61.79) is directly received by Cikka.
   */
  static calculateRewardsStoreRedemption(
    productValue: number,
    customPointsRequired?: number,
    isExpress: boolean = false
  ): RewardsStoreRedemptionResult {
    const val = Math.max(0, Number(productValue) || 1000);
    // Standard conversion: 1 CI Point = ₹1 face value (unless custom specified)
    const pointsBurned =
      customPointsRequired !== undefined && customPointsRequired > 0
        ? Number(customPointsRequired)
        : val;

    const customerPlatformFee = 9.99;
    const customerPlatformFeeGst = 1.8;
    const platformFeeTotal = 11.79;
    const expressDeliveryFee = isExpress ? 50.0 : 0.0;
    const totalPayableByCustomer = Number((platformFeeTotal + expressDeliveryFee).toFixed(2));

    return {
      productValue: val,
      pointsBurned,
      cashbackEarned: 0, // Strict rule: No cashback on rewards store redemptions
      ciPointsEarned: 0, // Strict rule: No new points generated on rewards burn
      customerPlatformFee,
      customerPlatformFeeGst,
      expressDeliveryFee,
      isExpress: Boolean(isExpress),
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
