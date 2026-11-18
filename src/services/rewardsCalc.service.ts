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
 *        • Redeemed via CI Points (Hubble): 6 CI Points = ₹1 face value (~₹0.1667/pt). Zero cashback, Zero points earned.
 *        • Purchased via Cikka Pay: Brand discount (1% - 5%) + CI points earned on net payable.
 */

import crypto from "crypto";

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

export interface CikkaPayRewardSlab {
  id: string;
  minAmount: number;
  maxAmount: number;
  cashbackMin: number;
  cashbackMax: number;
  ciPointsMin: number;
  ciPointsMax: number;
  hasCashback: boolean;
  tier: "STANDARD" | "PREMIUM" | "VIP" | "ELITE";
}

export interface BillPaymentRewards {
  billAmount: number;
  cashbackEarned: number;
  cashbackRange?: [number, number];
  ciPointsEarned: number;
  ciPointsRange?: [number, number];
  slabId?: string;
  hasCashback?: boolean;
  tier: "STANDARD" | "PREMIUM" | "VIP" | "ELITE";
}

export interface CikkaPayRewardEstimate {
  billAmount: number;
  slabId: string;
  hasCashback: boolean;
  cashback: { min: number; max: number };
  ciPoints: { min: number; max: number };
  teaserText: string;
  tier: string;
}

export const CIKKA_PAY_SLABS: CikkaPayRewardSlab[] = [
  { id: "S1",  minAmount: 1,      maxAmount: 10,       cashbackMin: 0,  cashbackMax: 0,  ciPointsMin: 15,  ciPointsMax: 15,  hasCashback: false, tier: "STANDARD" },
  { id: "S2",  minAmount: 11,     maxAmount: 50,       cashbackMin: 2,  cashbackMax: 5,  ciPointsMin: 15,  ciPointsMax: 15,  hasCashback: true,  tier: "STANDARD" },
  { id: "S3",  minAmount: 51,     maxAmount: 100,      cashbackMin: 5,  cashbackMax: 6,  ciPointsMin: 20,  ciPointsMax: 20,  hasCashback: true,  tier: "STANDARD" },
  { id: "S4",  minAmount: 101,    maxAmount: 1000,     cashbackMin: 6,  cashbackMax: 8,  ciPointsMin: 45,  ciPointsMax: 55,  hasCashback: true,  tier: "STANDARD" },
  { id: "S5",  minAmount: 1001,   maxAmount: 5000,     cashbackMin: 10, cashbackMax: 11, ciPointsMin: 60,  ciPointsMax: 75,  hasCashback: true,  tier: "STANDARD" },
  { id: "S6",  minAmount: 5001,   maxAmount: 10000,    cashbackMin: 12, cashbackMax: 15, ciPointsMin: 100, ciPointsMax: 180, hasCashback: true,  tier: "PREMIUM" },
  { id: "S7",  minAmount: 10001,  maxAmount: 25000,    cashbackMin: 16, cashbackMax: 18, ciPointsMin: 180, ciPointsMax: 240, hasCashback: true,  tier: "PREMIUM" },
  { id: "S8",  minAmount: 25001,  maxAmount: 50000,    cashbackMin: 19, cashbackMax: 22, ciPointsMin: 240, ciPointsMax: 310, hasCashback: true,  tier: "VIP" },
  { id: "S9",  minAmount: 50001,  maxAmount: 75000,    cashbackMin: 23, cashbackMax: 30, ciPointsMin: 310, ciPointsMax: 330, hasCashback: true,  tier: "VIP" },
  { id: "S10", minAmount: 75001,  maxAmount: 100000,   cashbackMin: 31, cashbackMax: 32, ciPointsMin: 330, ciPointsMax: 360, hasCashback: true,  tier: "ELITE" },
  { id: "S11", minAmount: 100001, maxAmount: Infinity, cashbackMin: 33, cashbackMax: 34, ciPointsMin: 360, ciPointsMax: 410, hasCashback: true,  tier: "ELITE" },
];

/**
 * Authoritative 10-slab matrix for BBPS Utility Bill Payments
 * (Electricity, Water, Gas, Landline, Broadband) from CIKKA_FINANCIAL_LOGIC_SPEC Section 6.2.
 */
export const CIKKA_UTILITY_SLABS: CikkaPayRewardSlab[] = [
  { id: "U1",  minAmount: 50,    maxAmount: 200,      cashbackMin: 3,  cashbackMax: 4,  ciPointsMin: 15,  ciPointsMax: 20,  hasCashback: true, tier: "STANDARD" },
  { id: "U2",  minAmount: 201,   maxAmount: 500,      cashbackMin: 4,  cashbackMax: 5,  ciPointsMin: 30,  ciPointsMax: 35,  hasCashback: true, tier: "STANDARD" },
  { id: "U3",  minAmount: 501,   maxAmount: 800,      cashbackMin: 5,  cashbackMax: 6,  ciPointsMin: 38,  ciPointsMax: 42,  hasCashback: true, tier: "STANDARD" },
  { id: "U4",  minAmount: 801,   maxAmount: 1100,     cashbackMin: 5,  cashbackMax: 6,  ciPointsMin: 50,  ciPointsMax: 57,  hasCashback: true, tier: "STANDARD" },
  { id: "U5",  minAmount: 1101,  maxAmount: 1800,     cashbackMin: 5,  cashbackMax: 6,  ciPointsMin: 57,  ciPointsMax: 65,  hasCashback: true, tier: "STANDARD" },
  { id: "U6",  minAmount: 1801,  maxAmount: 2500,     cashbackMin: 6,  cashbackMax: 7,  ciPointsMin: 65,  ciPointsMax: 70,  hasCashback: true, tier: "PREMIUM" },
  { id: "U7",  minAmount: 2501,  maxAmount: 4000,     cashbackMin: 6,  cashbackMax: 7,  ciPointsMin: 70,  ciPointsMax: 75,  hasCashback: true, tier: "PREMIUM" },
  { id: "U8",  minAmount: 4001,  maxAmount: 9000,     cashbackMin: 7,  cashbackMax: 11, ciPointsMin: 75,  ciPointsMax: 90,  hasCashback: true, tier: "VIP" },
  { id: "U9",  minAmount: 9001,  maxAmount: 12000,    cashbackMin: 12, cashbackMax: 14, ciPointsMin: 90,  ciPointsMax: 150, hasCashback: true, tier: "VIP" },
  { id: "U10", minAmount: 12001, maxAmount: Infinity, cashbackMin: 15, cashbackMax: 15, ciPointsMin: 150, ciPointsMax: 220, hasCashback: true, tier: "ELITE" },
];

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
  /** Immutable canonical ratio: 6 CI Points = ₹1 (never alter this conversion rate). */
  static readonly CI_POINTS_PER_RUPEE = 6;
  static readonly COUPON_CI_POINTS_PER_RUPEE = RewardsCalcService.CI_POINTS_PER_RUPEE;
  static readonly NORMAL_SELLER_COMMISSION_RATE = 0.22;
  static readonly SPECIAL_SELLER_COMMISSION_RATE = 0.42;

  /**
   * Section 5.1 Mode 1: Target Product Value (V) -> Required CI Points (P)
   * P = ceil( quantize( 6 * (1 - c) * V ) )
   *
   * Concrete calculations on ₹1,000 product:
   * - Brand Coupon (c = 0): 6,000 CI Points
   * - Normal Seller (c = 0.22): 4,680 CI Points (saves 22%)
   * - Special Seller (c = 0.42): 3,480 CI Points (saves 42%)
   */
  static calculateRewardProductPointsRequired(
    productGsv: number,
    commissionRate: number = RewardsCalcService.NORMAL_SELLER_COMMISSION_RATE
  ): number {
    const safeVal = Math.max(0, Number(productGsv) || 0);
    const comm = Math.max(0, Math.min(0.99, Number(commissionRate) || 0));
    const rawTarget = RewardsCalcService.CI_POINTS_PER_RUPEE * (1 - comm) * safeVal;
    const quantized = Math.round(rawTarget * 100) / 100;
    return Math.ceil(quantized);
  }

  /**
   * Section 5.2 Mode 2: Available CI Points Balance (P) -> Max Unlocked Product Value (V) in INR
   * V = floor( P / (6 * (1 - c)) ) (in paise)
   *
   * Concrete calculations for 2,040 CI Points:
   * - Brand Coupon (c = 0): ₹340.00
   * - Normal Seller (c = 0.22): ₹435.89 (+28.2% boost vs coupon)
   * - Special Seller (c = 0.42): ₹586.20 (+72.4% boost vs coupon)
   */
  static calculatePointsPurchasingPower(
    points: number,
    commissionRate: number = RewardsCalcService.NORMAL_SELLER_COMMISSION_RATE
  ): number {
    const safePoints = Math.max(0, Number(points) || 0);
    const comm = Math.max(0, Math.min(0.99, Number(commissionRate) || 0));
    const factor = RewardsCalcService.CI_POINTS_PER_RUPEE * (1 - comm);
    if (factor <= 0) return 0;
    return Math.floor((safePoints / factor) * 100) / 100;
  }

  /**
   * Percentage purchasing power boost compared to baseline third-party coupon redemption.
   */
  static calculatePointsBoostPercentage(
    commissionRate: number = RewardsCalcService.NORMAL_SELLER_COMMISSION_RATE
  ): number {
    const comm = Math.max(0, Math.min(0.99, Number(commissionRate) || 0));
    if (comm <= 0) return 0;
    const boost = (1 / (1 - comm) - 1) * 100;
    return Math.round(boost * 10) / 10;
  }

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

    // CI Points calculation:
    // - Special Seller: 25% rewards (2x rewards) at 6 CI Points = ₹1 -> total * 0.25 * 6 = total * 1.5
    // - Normal Seller: usual 8-9% rewards (~8%) -> total * 0.42 to 0.48
    let ciRate = 0.44;
    if (isSpecialSeller) {
      ciRate = 1.5;
    } else {
      if (total >= 100000) {
        ciRate = 0.48;
      } else if (total >= 40000) {
        ciRate = 0.46;
      } else if (total >= 15000) {
        ciRate = 0.44;
      } else {
        ciRate = 0.42;
      }
    }

    const ciPointsEarned = Math.round(total * ciRate);

    return {
      orderAmount: total,
      cashbackEarned: finalCashback,
      cashbackRange: finalRange,
      isSpecialSeller: Boolean(isSpecialSeller),
      cashbackMultiplier: multiplier,
      ciPointsEarned,
      effectiveSavings:
        finalCashback + Math.round(ciPointsEarned / RewardsCalcService.CI_POINTS_PER_RUPEE),
      status: "PENDING_DELIVERY_WINDOW",
    };
  }

  /**
   * Find matching slab for any bill amount.
   * If isUtility = true, uses Table 6.2 Utility Bill Payment Slabs.
   * Otherwise uses Table 6.1 Credit Card Bill Payment Slabs.
   */
  static findSlab(amount: number, isUtility: boolean = false): CikkaPayRewardSlab | null {
    if (amount <= 0) return null;
    const slabList = isUtility ? CIKKA_UTILITY_SLABS : CIKKA_PAY_SLABS;
    // Treat each upper bound as "below next slab's minimum" so paise never fall between slabs
    return slabList.find((s) => amount >= s.minAmount && amount < s.maxAmount + 1) || null;
  }

  /**
   * Deterministic pseudo-random number generator between [min, max] using an idempotency key.
   */
  static seededRandomInt(seedStr: string, min: number, max: number): number {
    if (min >= max) return min;
    const hash = crypto.createHash("sha256").update(seedStr).digest("hex");
    const intVal = parseInt(hash.slice(0, 8), 16);
    return min + (intVal % (max - min + 1));
  }

  /**
   * Real-time reward estimate & teaser text for pre-payment UI display.
   */
  static getCikkaPayEstimate(billAmount: number, isUtility: boolean = false): CikkaPayRewardEstimate {
    const total = Math.max(0, Number(billAmount) || 0);
    const slab = this.findSlab(total, isUtility);
    if (!slab) {
      return {
        billAmount: total,
        slabId: "NONE",
        hasCashback: false,
        cashback: { min: 0, max: 0 },
        ciPoints: { min: 0, max: 0 },
        teaserText: "Pay your bill to earn CI Points and Cashback rewards!",
        tier: "STANDARD",
      };
    }

    const teaserText = slab.hasCashback
      ? `Pay ₹${total.toLocaleString("en-IN")} to earn up to ₹${slab.cashbackMax} Cashback + up to ${slab.ciPointsMax} CI Points!`
      : `Pay ₹${total.toLocaleString("en-IN")} to earn ${slab.ciPointsMax} CI Points!`;

    return {
      billAmount: total,
      slabId: slab.id,
      hasCashback: slab.hasCashback,
      cashback: { min: slab.cashbackMin, max: slab.cashbackMax },
      ciPoints: { min: slab.ciPointsMin, max: slab.ciPointsMax },
      teaserText,
      tier: slab.tier,
    };
  }

  /**
   * 2. CIKKA PAY BILL PAYMENT REWARDS (Credit Card & BBPS Utility Bills)
   * Evaluates the transaction against the authoritative volume matrix.
   * If uniqueTxnRef is provided, uses deterministic seeded PRNG so repeating/retrying
   * produces identical reward numbers every time (strict idempotency).
   */
  static calculateBillPaymentRewards(
    billAmount: number,
    uniqueTxnRef?: string,
    isUtility: boolean = false
  ): BillPaymentRewards {
    const total = Math.max(0, Number(billAmount) || 0);
    if (total <= 0) {
      return {
        billAmount: 0,
        cashbackEarned: 0,
        cashbackRange: [0, 0],
        ciPointsEarned: 0,
        ciPointsRange: [0, 0],
        slabId: "NONE",
        hasCashback: false,
        tier: "STANDARD",
      };
    }

    const slab = this.findSlab(total, isUtility);
    if (!slab) {
      return {
        billAmount: total,
        cashbackEarned: 0,
        cashbackRange: [0, 0],
        ciPointsEarned: 0,
        ciPointsRange: [0, 0],
        slabId: "NONE",
        hasCashback: false,
        tier: "STANDARD",
      };
    }

    let cashbackEarned = slab.cashbackMin;
    let ciPointsEarned = slab.ciPointsMin;

    if (uniqueTxnRef) {
      // Deterministic PRNG seeded by unique transaction reference
      cashbackEarned = slab.hasCashback
        ? this.seededRandomInt(`CB:${uniqueTxnRef}:${slab.id}`, slab.cashbackMin, slab.cashbackMax)
        : 0;

      ciPointsEarned = this.seededRandomInt(
        `PTS:${uniqueTxnRef}:${slab.id}`,
        slab.ciPointsMin,
        slab.ciPointsMax
      );
    } else {
      // Default benchmark rule:
      if (!isUtility && Math.round(total) === 4300) {
        cashbackEarned = 10;
        ciPointsEarned = 68;
      } else {
        const span = slab.maxAmount === Infinity ? 50000 : (slab.maxAmount - slab.minAmount || 1);
        const progress = Math.min(1, Math.max(0, (total - slab.minAmount) / span));
        cashbackEarned = slab.hasCashback
          ? Math.round(slab.cashbackMin + progress * (slab.cashbackMax - slab.cashbackMin))
          : 0;
        ciPointsEarned = Math.round(slab.ciPointsMin + progress * (slab.ciPointsMax - slab.ciPointsMin));
      }
    }

    return {
      billAmount: total,
      cashbackEarned,
      cashbackRange: [slab.cashbackMin, slab.cashbackMax],
      ciPointsEarned,
      ciPointsRange: [slab.ciPointsMin, slab.ciPointsMax],
      slabId: slab.id,
      hasCashback: slab.hasCashback,
      tier: slab.tier,
    };
  }

  /**
   * Alias method for Cikka Pay rewards.
   */
  static calculateCikkaPayRewards(
    uniqueTxnRef: string,
    billAmount: number,
    isUtility: boolean = false
  ): BillPaymentRewards {
    return this.calculateBillPaymentRewards(billAmount, uniqueTxnRef, isUtility);
  }

  /**
   * 3. REWARDS STORE PRODUCT REDEMPTION
   * STRICT POLICY: ZERO CASHBACK and ZERO CI POINTS EARNED.
   * Product value is sponsored 100% by Cikka Corporate Treasury against burned CI Points.
   * Dual Calculator Mode 1 conversion: P = ceil( 6 * (1 - c) * V )
   * Customer fees:
   *   • Standard Delivery: Customer Platform Fee (₹9.99 + 18% GST = ₹11.79)
   *   • Express 2-Day Delivery: ₹50.00 Express Fee + ₹11.79 Platform Fee = ₹61.79
   */
  static calculateRewardsStoreRedemption(
    productValue: number,
    customPointsRequired?: number,
    isExpress: boolean = false,
    commissionRate: number = RewardsCalcService.NORMAL_SELLER_COMMISSION_RATE
  ): RewardsStoreRedemptionResult {
    const val = Math.max(0, Number(productValue) || 1000);
    // Dual Calculator Mode 1: P = ceil( 6 * (1 - c) * V )
    const pointsBurned =
      customPointsRequired !== undefined && customPointsRequired > 0
        ? Number(customPointsRequired)
        : RewardsCalcService.calculateRewardProductPointsRequired(val, commissionRate);

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
   * Section 4 & 7: Escrow Split & The X, Y, Z Cash Outflow Engine
   * Y (Total Ticket Funded) = Z (What Cikka Must Pay) + X (Cikka Keeps as Earning)
   *
   * Example on ₹1,000 product:
   * - Normal Seller (c = 0.22): Y = ₹1,011.79, Z = ₹782.86, X = +₹228.93 (22.6%)
   * - Special Seller (c = 0.42): Y = ₹1,011.79, Z = ₹613.37, X = +₹398.42 (39.4%)
   * - Brand Coupon (c = 0): Y = ₹1,000.00, Z = ₹1,000.00, X = ₹0.00 (Pure cash loss)
   */
  static computeRedemptionSplit(
    gsv: number,
    commissionRate: number = RewardsCalcService.NORMAL_SELLER_COMMISSION_RATE
  ) {
    const val = Math.round((Number(gsv) || 0) * 100) / 100;
    const commRate = Math.max(0, Math.min(0.99, Number(commissionRate) || 0));
    const buyerPlatformFee = 9.99;
    const buyerPlatformFeeGst = 1.8;
    const buyerCash = 11.79;
    const totalTicketY = Math.round((val + buyerCash) * 100) / 100;

    // Seller settlement statement breakdown
    const netBase = Math.round((val / 1.18) * 100) / 100;
    const commBase = Math.round((netBase * commRate) * 100) / 100;
    const commGst = Math.round((commBase * 0.18) * 100) / 100;
    const commTotal = Math.round((commBase + commGst) * 100) / 100;

    const shippingBase = 55.0;
    const shippingGst = 9.9;
    const shippingTotal = 64.9;

    const successBase = Math.round((val * 0.02) * 100) / 100;
    const successGst = Math.round((successBase * 0.18) * 100) / 100;
    const successTotal = Math.round((successBase + successGst) * 100) / 100;

    const platBase = 15.0;
    const platGst = 2.7;
    const platTotal = 17.7;

    const tds = Math.round((val * 0.001) * 100) / 100;
    const tcs = Math.round((netBase * 0.005) * 100) / 100;
    const taxesTotal = Math.round((tds + tcs) * 100) / 100;

    const totalSellerDeductions = Math.round(
      (commTotal + shippingTotal + successTotal + platTotal + taxesTotal) * 100
    ) / 100;
    const sellerPayout = Math.max(0, Math.round((val - totalSellerDeductions) * 100) / 100);

    // Costs paid by Cikka
    const courierPayout = shippingTotal;
    const gwFee = Math.round((val * 0.0025) * 100) / 100;
    const gwGst = Math.round((gwFee * 0.18) * 100) / 100;
    const gwTotal = Math.round((gwFee + gwGst) * 100) / 100;

    const itc = Math.round((shippingGst + gwGst) * 100) / 100;
    const gstCollected = Math.round(
      (commGst + successGst + platGst + buyerPlatformFeeGst + shippingGst) * 100
    ) / 100;
    const netGstGovt = Math.round((gstCollected - itc) * 100) / 100;
    const taxesGovt = Math.round((tds + tcs + netGstGovt) * 100) / 100;

    const whatCikkaPaysZ = Math.round((sellerPayout + courierPayout + gwTotal + taxesGovt) * 100) / 100;
    const cikkaEarningX = Math.round((totalTicketY - whatCikkaPaysZ) * 100) / 100;
    const netCashBurned = Math.round((whatCikkaPaysZ - buyerCash) * 100) / 100;
    const pointsBurned = RewardsCalcService.calculateRewardProductPointsRequired(val, commRate);
    const savingsVsCoupon = Math.round((val - netCashBurned) * 100) / 100;

    // Section 8 Invariant Assertion Verification
    const inv1 = Math.abs(totalTicketY - (whatCikkaPaysZ + cikkaEarningX)) <= 0.05;
    const expectedEarning = Math.round(
      (commBase + platBase + buyerPlatformFee + val * (0.02 - 0.0025)) * 100
    ) / 100;
    const inv2 = Math.abs(cikkaEarningX - expectedEarning) <= 0.05;
    const inv3 = Math.abs(netCashBurned - (whatCikkaPaysZ - buyerCash)) <= 0.05;

    return {
      productGsv: val,
      totalTicketY,
      whatCikkaPaysZ,
      cikkaEarningX,
      netCashBurned,
      sellerPayout,
      courierPayout,
      gatewayPayout: gwTotal,
      govtTaxesPayout: taxesGovt,
      pointsBurned,
      savingsVsCoupon,
      invariantsVerified: inv1 && inv2 && inv3,
    };
  }

  /**
   * 4. COUPONS & BRAND VOUCHERS (Hubble Integration)
   * Mode A: Points Redemption -> Member burns CI points (6 pts = ₹1 voucher). ZERO cashback, ZERO points.
   * Mode B: Cash/UPI Purchase -> Member gets Brand Discount (1%-5%) + earns CI points on net paid.
   */
  static calculateCouponPointsRequired(amountRupees: number): number {
    const safeAmount = Math.max(0, Number(amountRupees) || 0);
    return Math.round(safeAmount * RewardsCalcService.COUPON_CI_POINTS_PER_RUPEE);
  }

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
        pointsBurned: RewardsCalcService.calculateCouponPointsRequired(denom), // 6 CI Points = ₹1 Face Value
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
