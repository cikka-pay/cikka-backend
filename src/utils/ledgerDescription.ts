/**
 * Sanitizes customer-facing ledger descriptions so internal vendor names (e.g. Hubble),
 * full gateway/order IDs, and voucher face-value figures never leak into user passbooks.
 */

const ORDER_REF_SUFFIX_RE =
  /(?:\s*(?:for|to|of)?\s*(?:order|redemption|transaction|tx|ref)\s*#?:?\s*|\s*#\s*)(?:order_|hubble_ord_|ord-rw-|rdm-|vchr-)?[a-z0-9_-]{6,}/gi;

const LONG_OPAQUE_ID_RE =
  /\b(?:0[0-9a-hjkmnp-tv-z]{25}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:order|hubble_ord)_[a-z0-9_-]+)\b/gi;

export function formatCustomerLedgerDescription(
  rawDescription?: string | null,
  txType?: string | null
): string {
  const raw = (rawDescription || "").trim();
  const normalizedType = (txType || "").toUpperCase();

  if (!raw) {
    switch (normalizedType) {
      case "EARN_CASHBACK":
        return "Cashback Credited";
      case "CASHBACK_REDEEM":
        return "Cashback Applied";
      case "EARN_ORDER":
        return "CI Points Earned";
      case "EARN_BBPS":
        return "Bill Payment CI Points";
      case "REDEEM_REWARD":
        return "Reward Redeemed";
      case "DEBIT_BBPS":
        return "Bill Payment Reversal";
      default:
        return "Wallet Activity";
    }
  }

  // Brand voucher redemptions & reversals (never expose partner name or raw ULID/INR amount)
  if (/hubble\s+(?:voucher|gift\s*card)/i.test(raw) || /voucher\s+purchase\s*:/i.test(raw)) {
    return "Brand Voucher Redeemed";
  }
  if (/hubble\s+reversal|failed\s+hubble\s+voucher/i.test(raw)) {
    return "Voucher Points Restored";
  }

  // Cikka Mall order points & cashback (strip raw #order_... IDs)
  if (/^cikka\s+mall\s+ci\s+points/i.test(raw)) {
    return "Cikka Mall CI Points";
  }
  if (/^cikka\s+mall\s+cashback/i.test(raw)) {
    return "Cikka Mall Cashback";
  }
  if (/^cashback\s+discount\s+applied/i.test(raw)) {
    return "Cashback Applied";
  }

  // Returns, cancellations & rewards store redemptions
  if (/^rewards\s+store\s+redemption\s*:/i.test(raw)) {
    const productTitle = raw.replace(/^rewards\s+store\s+redemption\s*:\s*/i, "").trim();
    return productTitle || "Rewards Store Order";
  }
  if (/out\s+of\s+stock.*redemption/i.test(raw)) {
    return "Rewards Store Points Restored";
  }
  if (/restored\s+for\s+returned\s+reward/i.test(raw)) {
    return "Order Returned • Points Restored";
  }
  if (/order\s+cancellation\s+for/i.test(raw)) {
    return "Order Cancelled • Points Restored";
  }
  if (/^withdrawal\s+of\s+/i.test(raw)) {
    return normalizedType === "CASHBACK_REDEEM" ? "Cashback Withdrawal" : "CI Points Redemption";
  }

  // General sanitization fallback for any remaining vendor or opaque ID text
  let cleaned = raw
    .replace(/\bhubble\b/gi, "Brand")
    .replace(ORDER_REF_SUFFIX_RE, "")
    .replace(LONG_OPAQUE_ID_RE, "")
    .replace(/\(\s*ref\s*:[^)]*\)/gi, "")
    .replace(/\(\s*₹[\d,]+(?:\.\d+)?\s*\)/g, "")
    .replace(/[:•-]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || formatCustomerLedgerDescription(null, txType);
}
