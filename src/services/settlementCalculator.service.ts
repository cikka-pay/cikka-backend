/**
 * Cikka Marketplace — Settlement Split & Accounting Calculation Engine
 * Implements deterministic order & period settlement formulas according to Cikka specifications.
 */

export interface SettlementFeeConfig {
  commissionRate: number;      // 22% of base_product_value
  gstRate: number;             // 18% standard GST
  shippingFee: number;         // ₹55 fixed seller shipping
  sellerPlatformFee: number;   // ₹15 fixed seller platform fee
  customerPlatformFee: number; // ₹9.99 fixed customer platform fee
  successFeeRate: number;      // 2% of gross_product_value
  tdsRate: number;             // 0.1% of gross_product_value
  tcsRate: number;             // 0.5% of base_product_value
}

export const DEFAULT_SETTLEMENT_CONFIG: SettlementFeeConfig = {
  commissionRate: 22,
  gstRate: 18,
  shippingFee: 55.0,
  sellerPlatformFee: 15.0,
  customerPlatformFee: 9.99,
  successFeeRate: 2.0,
  tdsRate: 0.1,
  tcsRate: 0.5,
};

export interface SettlementLedgerBreakdown {
  // Input
  grossProductValue: number;      // Product selling price (GST inclusive)
  baseProductValue: number;       // Gross ÷ 1.18
  productGst: number;             // Gross - Base

  // Seller Charges
  commissionRate: number;         // 22%
  commission: number;             // Base × 22%
  commissionGst: number;          // Commission × 18%
  commissionTotal: number;        // Commission + GST

  shipping: number;               // Fixed ₹55
  shippingGst: number;            // Fixed ₹9.90 (18%)
  shippingTotal: number;          // ₹64.90

  sellerPlatformFee: number;      // Fixed ₹15
  sellerPlatformFeeGst: number;   // Fixed ₹2.70 (18%)
  sellerPlatformTotal: number;    // ₹17.70

  tdsRate: number;                // 0.1%
  tds: number;                    // Gross × 0.1%

  tcsRate: number;                // 0.5%
  tcs: number;                    // Base × 0.5%

  successFeeRate: number;         // 2%
  successFee: number;             // Gross × 2%
  successFeeGst: number;          // Success Fee × 18%
  successFeeTotal: number;        // Success Fee + GST

  // Customer Charges
  customerPlatformFee: number;    // Fixed ₹9.99
  customerPlatformFeeGst: number; // Fixed ₹1.80 (18%)
  customerPlatformTotal: number;  // ₹11.79
  customerTotalPayment: number;   // Gross Product Value + Customer Platform Total

  // Final Net Totals
  totalSellerDeductions: number;  // All deductions from base product value
  sellerNetSettlement: number;    // Amount transferred to seller's Razorpay Linked Account (T+7 hold)

  // Express Delivery Accounting
  expressDeliveryFee?: number;    // ₹50 if express requested
  expressSellerShare?: number;    // ₹28 if single/same-brand, ₹0 if cross-brand
  expressCikkaShare?: number;     // ₹22 if single/same-brand, ₹50 if cross-brand
  isExpress?: boolean;
  isSameBrandExpress?: boolean;

  // Cikka Revenue Accounting (BEFORE GST)
  cikkaFeeRevenue: number;        // Commission + Seller Platform Fee + Success Fee + Customer Platform Fee + Express Cikka Share
  cikkaGstCollected: number;      // GST collected across all Cikka fees (Liability)
}

export interface ExpressDeliveryBreakdownOptions {
  isExpress?: boolean;
  isSameBrandExpress?: boolean;
  isPrimarySubOrder?: boolean;
}

/**
 * Rounds a number to exactly 2 decimal places deterministically.
 */
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Calculates complete deterministic settlement split and accounting breakdown.
 * Retains high precision internally and formats monetary outputs to 2 decimal places.
 *
 * @param grossProductValue Product selling price inclusive of 18% GST (e.g. 1000)
 * @param customConfig Optional fee overrides (e.g. custom category commission)
 * @param ordersCount Order items count
 * @param expressOptions Optional Express delivery configuration and split parameters
 */
export function calculateSettlementBreakdown(
  grossProductValue: number,
  customConfig?: Partial<SettlementFeeConfig>,
  ordersCount: number = 1,
  expressOptions?: ExpressDeliveryBreakdownOptions
): SettlementLedgerBreakdown {
  const config: SettlementFeeConfig = {
    ...DEFAULT_SETTLEMENT_CONFIG,
    ...customConfig,
  };

  const count = Math.max(ordersCount || 1, 1);
  const gross = Number(grossProductValue) || 0;

  const isExpress = Boolean(expressOptions?.isExpress);
  const isSameBrandExpress = Boolean(expressOptions?.isSameBrandExpress);
  const isPrimary = expressOptions?.isPrimarySubOrder !== false;

  let expressDeliveryFee = 0;
  let expressSellerShare = 0;
  let expressCikkaShare = 0;

  if (isExpress) {
    expressDeliveryFee = 50;
    if (isSameBrandExpress) {
      // Rule 1: Single order OR multi-order SAME brand express: Split ₹28 to seller, ₹22 to Cikka
      expressSellerShare = isPrimary ? 28 : 0;
      expressCikkaShare = isPrimary ? 22 : 0;
    } else {
      // Rule 2: Multi-order DIFFERENT brands express: ₹0 to seller, whole ₹50 to Cikka; shipping paid by seller
      expressSellerShare = 0;
      expressCikkaShare = isPrimary ? 50 : 0;
    }
  }

  if (gross <= 0) {
    return {
      grossProductValue: 0,
      baseProductValue: 0,
      productGst: 0,
      commissionRate: config.commissionRate,
      commission: 0,
      commissionGst: 0,
      commissionTotal: 0,
      shipping: 0,
      shippingGst: 0,
      shippingTotal: 0,
      sellerPlatformFee: 0,
      sellerPlatformFeeGst: 0,
      sellerPlatformTotal: 0,
      tdsRate: config.tdsRate,
      tds: 0,
      tcsRate: config.tcsRate,
      tcs: 0,
      successFeeRate: config.successFeeRate,
      successFee: 0,
      successFeeGst: 0,
      successFeeTotal: 0,
      customerPlatformFee: config.customerPlatformFee * count,
      customerPlatformFeeGst: round2(config.customerPlatformFee * count * (config.gstRate / 100)),
      customerPlatformTotal: round2(config.customerPlatformFee * count * (1 + config.gstRate / 100)),
      customerTotalPayment: 0,
      totalSellerDeductions: 0,
      sellerNetSettlement: expressSellerShare,
      expressDeliveryFee,
      expressSellerShare,
      expressCikkaShare,
      isExpress,
      isSameBrandExpress,
      cikkaFeeRevenue: expressCikkaShare,
      cikkaGstCollected: 0,
    };
  }

  const gstMultiplier = 1 + config.gstRate / 100; // 1.18

  // 1. Base & GST Breakdown (Net Base Price = GSV ÷ 1.18)
  const baseProductValue = round2(gross / gstMultiplier);
  const productGst = round2(gross - baseProductValue);

  // 2. Commission (Base × CommissionRate%)
  const commission = round2(baseProductValue * (config.commissionRate / 100));
  const commissionGst = round2(commission * (config.gstRate / 100));
  const commissionTotal = round2(commission + commissionGst);

  // 3. Shipping (₹55 × ordersCount + 18% GST)
  const shipping = round2(config.shippingFee * count);
  const shippingGst = round2(shipping * (config.gstRate / 100));
  const shippingTotal = round2(shipping + shippingGst);

  // 4. Success Fee (2% on GSV + 18% GST)
  const successFee = round2(gross * (config.successFeeRate / 100));
  const successFeeGst = round2(successFee * (config.gstRate / 100));
  const successFeeTotal = round2(successFee + successFeeGst);

  // 5. Seller Platform Fee (₹15 × ordersCount + 18% GST)
  const sellerPlatformFee = round2(config.sellerPlatformFee * count);
  const sellerPlatformFeeGst = round2(sellerPlatformFee * (config.gstRate / 100));
  const sellerPlatformTotal = round2(sellerPlatformFee + sellerPlatformFeeGst);

  // 6. Statutory Taxes (TDS: 0.1% on Gross, TCS: 0.5% on Base)
  const tds = round2(gross * (config.tdsRate / 100));
  const tcs = round2(baseProductValue * (config.tcsRate / 100));
  const statutoryTaxes = round2(tds + tcs);

  // 7. Customer Platform Fee (₹9.99 + 18% GST)
  const customerPlatformFee = round2(config.customerPlatformFee * count);
  const customerPlatformFeeGst = round2(customerPlatformFee * (config.gstRate / 100));
  const customerPlatformTotal = round2(customerPlatformFee + customerPlatformFeeGst);
  const customerTotalPayment = round2(gross + customerPlatformTotal);

  // 8. Total Seller Deductions
  const totalSellerDeductions = round2(
    commissionTotal +
    shippingTotal +
    successFeeTotal +
    sellerPlatformTotal +
    statutoryTaxes
  );

  // 9. Seller Net Settlement = GSV - Total Seller Deductions + expressSellerShare
  const sellerNetSettlement = Math.max(0, round2(gross - totalSellerDeductions + expressSellerShare));

  // 10. Cikka Revenue (Commission + Seller Platform Fee + Success Fee + Customer Platform Fee + expressCikkaShare BEFORE GST)
  const cikkaFeeRevenue = round2(
    commission +
    sellerPlatformFee +
    successFee +
    customerPlatformFee +
    expressCikkaShare
  );

  // 11. GST Collected on Cikka Fees (Tax liability)
  const cikkaGstCollected = round2(
    commissionGst +
    sellerPlatformFeeGst +
    successFeeGst +
    customerPlatformFeeGst
  );

  return {
    grossProductValue: round2(gross),
    baseProductValue,
    productGst,

    commissionRate: config.commissionRate,
    commission,
    commissionGst,
    commissionTotal,

    shipping,
    shippingGst,
    shippingTotal,

    sellerPlatformFee,
    sellerPlatformFeeGst,
    sellerPlatformTotal,

    tdsRate: config.tdsRate,
    tds,

    tcsRate: config.tcsRate,
    tcs,

    successFeeRate: config.successFeeRate,
    successFee,
    successFeeGst,
    successFeeTotal,

    customerPlatformFee,
    customerPlatformFeeGst,
    customerPlatformTotal,
    customerTotalPayment,

    totalSellerDeductions,
    sellerNetSettlement,

    expressDeliveryFee,
    expressSellerShare,
    expressCikkaShare,
    isExpress,
    isSameBrandExpress,

    cikkaFeeRevenue,
    cikkaGstCollected,
  };
}
