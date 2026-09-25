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

  // Cikka Revenue Accounting (BEFORE GST)
  cikkaFeeRevenue: number;        // Commission + Seller Platform Fee + Success Fee + Customer Platform Fee
  cikkaGstCollected: number;      // GST collected across all Cikka fees (Liability)
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
 */
export function calculateSettlementBreakdown(
  grossProductValue: number,
  customConfig?: Partial<SettlementFeeConfig>
): SettlementLedgerBreakdown {
  const config: SettlementFeeConfig = {
    ...DEFAULT_SETTLEMENT_CONFIG,
    ...customConfig,
  };

  const gross = Number(grossProductValue) || 0;
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
      customerPlatformFee: config.customerPlatformFee,
      customerPlatformFeeGst: round2(config.customerPlatformFee * (config.gstRate / 100)),
      customerPlatformTotal: round2(config.customerPlatformFee * (1 + config.gstRate / 100)),
      customerTotalPayment: 0,
      totalSellerDeductions: 0,
      sellerNetSettlement: 0,
      cikkaFeeRevenue: 0,
      cikkaGstCollected: 0,
    };
  }

  const gstMultiplier = 1 + config.gstRate / 100; // 1.18

  // 1. Base & GST Breakdown
  const rawBase = gross / gstMultiplier;
  const rawProductGst = gross - rawBase;

  // 2. Commission (22% on Base)
  const rawCommission = rawBase * (config.commissionRate / 100);
  const rawCommissionGst = rawCommission * (config.gstRate / 100);
  const rawCommissionTotal = rawCommission + rawCommissionGst;

  // 3. Shipping (₹55 + 18% GST = ₹64.90)
  const rawShipping = config.shippingFee;
  const rawShippingGst = rawShipping * (config.gstRate / 100);
  const rawShippingTotal = rawShipping + rawShippingGst;

  // 4. Seller Platform Fee (₹15 + 18% GST = ₹17.70)
  const rawSellerPlatformFee = config.sellerPlatformFee;
  const rawSellerPlatformFeeGst = rawSellerPlatformFee * (config.gstRate / 100);
  const rawSellerPlatformTotal = rawSellerPlatformFee + rawSellerPlatformFeeGst;

  // 5. Statutory Taxes (TDS: 0.1% on Gross, TCS: 0.5% on Base)
  const rawTds = gross * (config.tdsRate / 100);
  const rawTcs = rawBase * (config.tcsRate / 100);

  // 6. Success Fee (2% on Gross + 18% GST = 2.36% on Gross)
  const rawSuccessFee = gross * (config.successFeeRate / 100);
  const rawSuccessFeeGst = rawSuccessFee * (config.gstRate / 100);
  const rawSuccessFeeTotal = rawSuccessFee + rawSuccessFeeGst;

  // 7. Customer Platform Fee (₹9.99 + 18% GST = ₹11.79)
  const rawCustomerPlatformFee = config.customerPlatformFee;
  const rawCustomerPlatformFeeGst = rawCustomerPlatformFee * (config.gstRate / 100);
  const rawCustomerPlatformTotal = rawCustomerPlatformFee + rawCustomerPlatformFeeGst;
  const rawCustomerTotalPayment = gross + rawCustomerPlatformTotal;

  // 8. Seller Net Settlement (Calculated from Base Product Value)
  const rawSellerDeductions =
    rawCommissionTotal +
    rawShippingTotal +
    rawSellerPlatformTotal +
    rawTds +
    rawTcs +
    rawSuccessFeeTotal;

  const rawSellerNet = rawBase - rawSellerDeductions;

  // 9. Cikka Revenue (Commission + Seller Platform Fee + Success Fee + Customer Platform Fee BEFORE GST)
  const rawCikkaFeeRevenue =
    rawCommission +
    rawSellerPlatformFee +
    rawSuccessFee +
    rawCustomerPlatformFee;

  // 10. GST Collected on Cikka Fees (Tax liability)
  const rawCikkaGstCollected =
    rawCommissionGst +
    rawSellerPlatformFeeGst +
    rawSuccessFeeGst +
    rawCustomerPlatformFeeGst;

  return {
    grossProductValue: round2(gross),
    baseProductValue: round2(rawBase),
    productGst: round2(rawProductGst),

    commissionRate: config.commissionRate,
    commission: round2(rawCommission),
    commissionGst: round2(rawCommissionGst),
    commissionTotal: round2(rawCommissionTotal),

    shipping: round2(rawShipping),
    shippingGst: round2(rawShippingGst),
    shippingTotal: round2(rawShippingTotal),

    sellerPlatformFee: round2(rawSellerPlatformFee),
    sellerPlatformFeeGst: round2(rawSellerPlatformFeeGst),
    sellerPlatformTotal: round2(rawSellerPlatformTotal),

    tdsRate: config.tdsRate,
    tds: round2(rawTds),

    tcsRate: config.tcsRate,
    tcs: round2(rawTcs),

    successFeeRate: config.successFeeRate,
    successFee: round2(rawSuccessFee),
    successFeeGst: round2(rawSuccessFeeGst),
    successFeeTotal: round2(rawSuccessFeeTotal),

    customerPlatformFee: round2(rawCustomerPlatformFee),
    customerPlatformFeeGst: round2(rawCustomerPlatformFeeGst),
    customerPlatformTotal: round2(rawCustomerPlatformTotal),
    customerTotalPayment: round2(rawCustomerTotalPayment),

    totalSellerDeductions: round2(rawSellerDeductions),
    sellerNetSettlement: Math.max(0, round2(rawSellerNet)),

    cikkaFeeRevenue: round2(rawCikkaFeeRevenue),
    cikkaGstCollected: round2(rawCikkaGstCollected),
  };
}
