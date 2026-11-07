/**
 * Server-side Cikka Mall pricing (spec 003 §1–3).
 *
 * The single pricing function used by POST /api/mall/quote, /payment/create-order,
 * /payment/pay-with-card and fulfilment. Prices come from Product / ProductVariant rows,
 * never from the client. All arithmetic is in integer paise.
 */
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { config } from "../config/env";
import { walletService } from "./wallet.service";

// ── Server constants (the client cannot change these) ────────────────────────
export const EXPRESS_DELIVERY_FEE_PAISE = 5000; // ₹50
export const MAX_CASHBACK_REDEMPTION_PAISE = 20000; // ₹200 per order (CartScreen "MAX ₹200")
/** Customer platform fee: ₹9.99 + 18% GST = ₹11.79. Charged on Rewards redemptions. */
export const CUSTOMER_PLATFORM_FEE_PAISE = 999;
export const CUSTOMER_PLATFORM_FEE_GST_PAISE = 180;
export const CUSTOMER_PLATFORM_FEE_TOTAL_PAISE = CUSTOMER_PLATFORM_FEE_PAISE + CUSTOMER_PLATFORM_FEE_GST_PAISE;
/** The mall checkout has never charged the platform fee (the app does not show one). */
export const MALL_CHARGES_PLATFORM_FEE = false;
export const MAX_QTY_PER_LINE = 20;
export const QUOTE_TTL_MS = 10 * 60 * 1000;
/** Days after delivery during which an order can still be exchanged. */
export const EXCHANGE_WINDOW_DAYS = 7;

export type DeliveryOption = "standard" | "express";

export class PricingError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "PricingError";
  }
}

export interface PricingItemInput {
  productId: string;
  variantId?: string | null;
  qty: number;
  size?: string | null;
  color?: string | null;
}

export interface ExchangeRef {
  orderId?: string | null;
  orderNumber?: string | null;
}

export interface PricingInput {
  items: PricingItemInput[];
  deliveryOption: DeliveryOption;
  couponCode?: string | null;
  useCashback?: boolean;
  useCiPoints?: boolean;
  exchange?: ExchangeRef | null;
}

export interface PricedLine {
  productId: string;
  variantId: string | null;
  variantLabel: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  sku: string;
  sellerId: string;
  qty: number;
  unitPricePaise: number;
  mrpPaise: number | null;
  lineTotalPaise: number;
  lineMrpTotalPaise: number;
}

export interface PricedExchange {
  orderId: string;
  orderNumber: string;
  sellerId: string;
  creditPaise: number;
  refundDuePaise: number;
}

export interface PricedCart {
  lines: PricedLine[];
  deliveryOption: DeliveryOption;
  subtotalPaise: number;
  mrpTotalPaise: number;
  couponPaise: number;
  cashbackPaise: number;
  ciPointsPaise: number;
  expressFeePaise: number;
  platformFeePaise: number;
  platformFeeGstPaise: number;
  exchange: PricedExchange | null;
  totalPaise: number;
  cashbackBalancePaise: number | null;
  notes: string[];
}

// ── Money helpers ────────────────────────────────────────────────────────────

/** Exact Decimal(10,2) → integer paise, without going through binary floating point. */
export function decimalToPaise(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const str = typeof value === "object" && value !== null && "toFixed" in (value as any)
    ? (value as any).toFixed(2)
    : Number(value).toFixed(2);
  const negative = str.startsWith("-");
  const [whole, frac = "0"] = str.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -paise : paise;
}

export const paiseToRupees = (paise: number): number => Math.round(paise) / 100;

// ── Request parsing ──────────────────────────────────────────────────────────

const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

/**
 * Normalise a quote / create-order body. Accepts the app's current field names as aliases
 * (`items[].id`, `delivery_option`, `apply_cashback`). Client prices are dropped here.
 */
export function parsePricingRequest(body: any): PricingInput {
  const rawItems = Array.isArray(body?.items) ? body.items : Array.isArray(body?.cartItems) ? body.cartItems : [];
  if (rawItems.length === 0) throw new PricingError(400, "EMPTY_CART", "Add at least one item to the cart.");
  if (rawItems.length > 50) throw new PricingError(400, "INVALID_QTY", "Too many cart lines.");

  const items: PricingItemInput[] = rawItems.map((raw: any) => {
    const productId = String(raw?.productId ?? raw?.product_id ?? raw?.product?.id ?? raw?.id ?? "").trim();
    const qty = Number(raw?.qty ?? raw?.quantity ?? 1);
    if (!productId) throw new PricingError(400, "UNKNOWN_PRODUCT", "Every item needs a productId.");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
      throw new PricingError(400, "INVALID_QTY", `Quantity must be a whole number between 1 and ${MAX_QTY_PER_LINE}.`, { productId });
    }
    const variantId = raw?.variantId ?? raw?.variant_id ?? null;
    return {
      productId,
      variantId: variantId ? String(variantId) : null,
      qty,
      size: raw?.size ?? raw?.selectedSize ?? null,
      color: raw?.color ?? raw?.selectedColor ?? null,
    };
  });

  const rawDelivery = String(body?.deliveryOption ?? body?.delivery_option ?? body?.deliveryMode ?? "standard").toLowerCase();
  const deliveryOption: DeliveryOption =
    rawDelivery === "express" || truthy(body?.is_express) ? "express" : "standard";

  const ex = body?.exchange ?? null;
  const exchange: ExchangeRef | null =
    ex && (ex.orderId || ex.orderNumber || ex.order_id || ex.order_number)
      ? {
          orderId: ex.orderId ?? ex.order_id ?? null,
          orderNumber: ex.orderNumber ?? ex.order_number ?? null,
        }
      : null;

  const coupon = body?.couponCode ?? body?.coupon_code ?? null;
  return {
    items,
    deliveryOption,
    couponCode: coupon ? String(coupon).trim() : null,
    useCashback: truthy(body?.useCashback ?? body?.use_cashback ?? body?.applyCashback ?? body?.apply_cashback),
    useCiPoints: truthy(body?.useCiPoints ?? body?.use_ci_points),
    exchange,
  };
}

// ── Seller payability (spec 003 §4: block checkout) ──────────────────────────

export interface SellerPayoutInfo {
  isSuspended: boolean;
  razorpayAccountId: string | null;
  razorpayAccountStatus: string | null;
  onboarding?: { razorpayAccountId: string | null; razorpayAccountStatus: string | null } | null;
}

/** Linked account the seller is paid to, or null when the seller cannot be paid via Route. */
export function sellerLinkedAccount(seller: SellerPayoutInfo | null | undefined): string | null {
  if (!seller || seller.isSuspended) return null;
  const accountId = seller.razorpayAccountId || seller.onboarding?.razorpayAccountId || null;
  const status = String(seller.razorpayAccountStatus || seller.onboarding?.razorpayAccountStatus || "").toLowerCase();
  if (!accountId) return null;
  return status === "activated" || status === "active" ? accountId : null;
}

// ── Product line resolution ──────────────────────────────────────────────────

const productInclude = {
  variants: true,
  seller: {
    select: {
      id: true,
      businessName: true,
      isSuspended: true,
      razorpayAccountId: true,
      razorpayAccountStatus: true,
      onboarding: { select: { razorpayAccountId: true, razorpayAccountStatus: true } },
    },
  },
} as const;

type LoadedProduct = NonNullable<Awaited<ReturnType<typeof loadProducts>>[number]>;

function loadProducts(ids: string[]) {
  return prisma.product.findMany({ where: { id: { in: ids } }, include: productInclude });
}

function resolveVariant(product: LoadedProduct, item: PricingItemInput) {
  if (item.variantId) {
    const v = product.variants.find((x) => x.id === item.variantId);
    if (!v) {
      throw new PricingError(400, "VARIANT_MISMATCH", `That option is not available for ${product.name}.`, {
        productId: product.id,
        variantId: item.variantId,
      });
    }
    return v;
  }
  const wanted = [item.size, item.color].filter((x): x is string => Boolean(x) && x !== "Standard" && x !== "Default");
  if (wanted.length === 0 || product.variants.length === 0) return null;
  for (const value of wanted) {
    const v = product.variants.find((x) => x.value.toLowerCase() === String(value).toLowerCase());
    if (v) return v;
  }
  throw new PricingError(400, "VARIANT_MISMATCH", `That option is not available for ${product.name}.`, {
    productId: product.id,
    requested: wanted,
  });
}

/**
 * Price cart lines from the DB. Rejects unknown or unpublished products, mismatched variants,
 * insufficient stock and sellers that cannot be paid.
 */
export async function priceLines(items: PricingItemInput[]): Promise<PricedLine[]> {
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await loadProducts(ids);
  const byId = new Map(products.map((p) => [p.id, p]));
  const demand = new Map<string, { available: number; qty: number; name: string }>();

  const lines = items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) {
      throw new PricingError(404, "UNKNOWN_PRODUCT", "A product in your cart is no longer available.", { productId: item.productId });
    }
    if (product.status !== "ACTIVE") {
      throw new PricingError(409, "PRODUCT_UNAVAILABLE", `${product.name} is not available for sale.`, { productId: product.id });
    }
    if (!product.seller) {
      throw new PricingError(409, "SELLER_NOT_PAYABLE", `${product.name} has no seller.`, { productId: product.id });
    }
    if (!sellerLinkedAccount(product.seller)) {
      throw new PricingError(409, "SELLER_NOT_PAYABLE", `${product.name} cannot be ordered right now (seller payouts not set up).`, {
        productId: product.id,
        sellerId: product.sellerId,
      });
    }

    const variant = resolveVariant(product, item);
    const unitPricePaise = decimalToPaise(variant?.price ?? product.price);
    if (unitPricePaise <= 0) {
      throw new PricingError(409, "PRODUCT_UNAVAILABLE", `${product.name} has no valid price.`, { productId: product.id });
    }
    const mrpPaise = product.mrp ? decimalToPaise(product.mrp) : null;

    const key = `${product.id}:${variant?.id ?? ""}`;
    const entry = demand.get(key) || { available: variant ? variant.stockQty : product.stockQty, qty: 0, name: product.name };
    entry.qty += item.qty;
    demand.set(key, entry);

    const effectiveMrp = mrpPaise && mrpPaise > unitPricePaise ? mrpPaise : unitPricePaise;
    return {
      productId: product.id,
      variantId: variant?.id ?? null,
      variantLabel: variant ? `${variant.typeName}: ${variant.value}` : null,
      name: product.name,
      brand: product.brandName || product.seller.businessName || null,
      category: product.category,
      sku: product.sku,
      sellerId: product.sellerId,
      qty: item.qty,
      unitPricePaise,
      mrpPaise,
      lineTotalPaise: unitPricePaise * item.qty,
      lineMrpTotalPaise: effectiveMrp * item.qty,
    } satisfies PricedLine;
  });

  for (const [key, d] of demand) {
    if (d.qty > d.available) {
      throw new PricingError(409, "INSUFFICIENT_STOCK", `Only ${Math.max(0, d.available)} left of ${d.name}.`, {
        productId: key.split(":")[0],
        available: Math.max(0, d.available),
        requested: d.qty,
      });
    }
  }
  return lines;
}

// ── Exchange credit (original order checks) ──────────────────────────────────

export interface ExchangeOrderCheck {
  order: { id: string; orderNumber: string; sellerId: string; totalAmount: unknown; status: string } | null;
  reasons: Array<{ code: string; message: string }>;
  creditPaise: number;
}

/** Razorpay order id behind an order number (`order_X` or `order_X-<n>`). */
export function baseRazorpayOrderId(orderNumber: string): string {
  return orderNumber.replace(/-\d+$/, "");
}

/** The buyer who owns an order: Order.userId, else the user on its Razorpay checkout. */
export async function orderOwnerId(order: { userId?: string | null; orderNumber: string }): Promise<string | null> {
  if (order.userId) return order.userId;
  const checkout = await prisma.razorpayCheckout.findUnique({
    where: { razorpayOrderId: baseRazorpayOrderId(order.orderNumber) },
    select: { userId: true },
  });
  return checkout?.userId ?? null;
}

/** Order-level exchange checks: ownership, state, active returns, return window. */
export async function checkExchangeOrder(userId: string | null, ref: ExchangeRef): Promise<ExchangeOrderCheck> {
  const reasons: Array<{ code: string; message: string }> = [];
  if (!ref.orderId && !ref.orderNumber) {
    return { order: null, reasons: [{ code: "ORDER_REQUIRED", message: "orderId or orderNumber is required." }], creditPaise: 0 };
  }
  const order = ref.orderId
    ? await prisma.order.findUnique({ where: { id: String(ref.orderId) } })
    : await prisma.order.findUnique({ where: { orderNumber: String(ref.orderNumber) } });
  if (!order) {
    return { order: null, reasons: [{ code: "ORDER_NOT_FOUND", message: "Original order not found." }], creditPaise: 0 };
  }

  const owner = await orderOwnerId(order);
  if (owner && owner !== userId) {
    reasons.push({ code: "NOT_YOUR_ORDER", message: "This order belongs to another account." });
  }
  if (["EXCHANGE", "RETURNED", "CANCELLED"].includes(order.status)) {
    reasons.push({ code: "ORDER_CLOSED", message: "This order has already been exchanged, returned or cancelled." });
  }
  const activeReturn = await prisma.return.findFirst({
    where: { orderId: order.id, status: { in: ["REQUESTED", "APPROVED", "REFUNDED"] } },
    select: { id: true },
  });
  if (activeReturn) reasons.push({ code: "RETURN_IN_PROGRESS", message: "A return already exists for this order." });
  if (order.status === "DELIVERED" && order.deliveredAt) {
    const closes = order.deliveredAt.getTime() + EXCHANGE_WINDOW_DAYS * 86400000;
    if (Date.now() > closes) {
      reasons.push({ code: "WINDOW_CLOSED", message: `Exchanges are allowed within ${EXCHANGE_WINDOW_DAYS} days of delivery.` });
    }
  }
  return { order, reasons, creditPaise: decimalToPaise(order.totalAmount) };
}

// ── Cart pricing ─────────────────────────────────────────────────────────────

export async function priceCart(input: PricingInput, userId: string | null): Promise<PricedCart> {
  const notes: string[] = [];

  if (input.couponCode) {
    // No mall coupons exist on the server (the app has none either): never accept one blindly.
    throw new PricingError(400, "COUPON_INVALID", "This coupon code is not valid.", { couponCode: input.couponCode });
  }

  const lines = await priceLines(input.items);
  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  const mrpTotalPaise = lines.reduce((s, l) => s + l.lineMrpTotalPaise, 0);

  let exchange: PricedExchange | null = null;
  if (input.exchange) {
    if (lines.length !== 1 || lines[0].qty !== 1) {
      throw new PricingError(400, "EXCHANGE_SINGLE_ITEM", "An exchange replaces one item with exactly one item.");
    }
    const check = await checkExchangeOrder(userId, input.exchange);
    if (!check.order || check.reasons.length > 0) {
      throw new PricingError(409, "EXCHANGE_NOT_ELIGIBLE", check.reasons[0]?.message || "This order cannot be exchanged.", {
        reasons: check.reasons,
      });
    }
    exchange = {
      orderId: check.order.id,
      orderNumber: check.order.orderNumber,
      sellerId: check.order.sellerId,
      creditPaise: check.creditPaise,
      refundDuePaise: Math.max(0, check.creditPaise - subtotalPaise),
    };
  }

  const expressFeePaise = input.deliveryOption === "express" ? EXPRESS_DELIVERY_FEE_PAISE : 0;
  const platformFeePaise = MALL_CHARGES_PLATFORM_FEE ? CUSTOMER_PLATFORM_FEE_PAISE : 0;
  const platformFeeGstPaise = MALL_CHARGES_PLATFORM_FEE ? CUSTOMER_PLATFORM_FEE_GST_PAISE : 0;
  const goodsPaise = exchange ? Math.max(0, subtotalPaise - exchange.creditPaise) : subtotalPaise;

  let cashbackPaise = 0;
  let cashbackBalancePaise: number | null = null;
  if (userId) {
    cashbackBalancePaise = (await walletService.getBalance(userId)).cashPaise;
  }
  if (input.useCashback) {
    if (!userId) {
      throw new PricingError(401, "AUTH_REQUIRED_FOR_CASHBACK", "Sign in to use your cashback balance.");
    }
    if (exchange) {
      notes.push("Cashback cannot be combined with an exchange.");
    } else {
      cashbackPaise = Math.max(0, Math.min(MAX_CASHBACK_REDEMPTION_PAISE, goodsPaise, cashbackBalancePaise ?? 0));
      if ((cashbackBalancePaise ?? 0) < Math.min(MAX_CASHBACK_REDEMPTION_PAISE, goodsPaise)) {
        notes.push(`Cashback limited to your balance (₹${paiseToRupees(cashbackBalancePaise ?? 0).toFixed(2)}).`);
      }
    }
  }
  if (input.useCiPoints) {
    notes.push("CI Points can only be redeemed in the Rewards Store, not on mall orders.");
  }

  const totalPaise = Math.max(0, goodsPaise - cashbackPaise + expressFeePaise + platformFeePaise + platformFeeGstPaise);

  return {
    lines,
    deliveryOption: input.deliveryOption,
    subtotalPaise,
    mrpTotalPaise,
    couponPaise: 0,
    cashbackPaise,
    ciPointsPaise: 0,
    expressFeePaise,
    platformFeePaise,
    platformFeeGstPaise,
    exchange,
    totalPaise,
    cashbackBalancePaise,
    notes,
  };
}

// ── Quote id (short-lived, HMAC-signed) ──────────────────────────────────────

/** Stable hash of everything that determines what the buyer pays. */
export function quoteHash(cart: PricedCart): string {
  const canonical = JSON.stringify({
    lines: cart.lines.map((l) => [l.productId, l.variantId, l.qty, l.unitPricePaise]),
    delivery: cart.deliveryOption,
    cashback: cart.cashbackPaise,
    coupon: cart.couponPaise,
    exchange: cart.exchange ? [cart.exchange.orderId, cart.exchange.creditPaise] : null,
    total: cart.totalPaise,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

const quoteSecret = () => `quote:${config.jwtSecret}`;
const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signQuote(cart: PricedCart, userId: string | null, now = Date.now()) {
  const expiresAt = now + QUOTE_TTL_MS;
  const payload = b64url(JSON.stringify({ v: 1, h: quoteHash(cart), t: cart.totalPaise, u: userId || "", e: expiresAt }));
  const sig = crypto.createHmac("sha256", quoteSecret()).update(payload).digest("base64url");
  return { quoteId: `q_${payload}.${sig}`, expiresAt: new Date(expiresAt) };
}

/** null when the quote id is valid for this freshly priced cart; otherwise the reason. */
export function verifyQuote(quoteId: string, cart: PricedCart, userId: string | null, now = Date.now()): string | null {
  const m = /^q_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(quoteId || ""));
  if (!m) return "Malformed quote id.";
  const expected = crypto.createHmac("sha256", quoteSecret()).update(m[1]).digest("base64url");
  if (expected.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]))) {
    return "Invalid quote id.";
  }
  let body: any;
  try {
    body = JSON.parse(Buffer.from(m[1], "base64url").toString("utf-8"));
  } catch {
    return "Malformed quote id.";
  }
  if (body.e < now) return "Quote expired.";
  if ((body.u || "") !== (userId || "")) return "Quote belongs to another session.";
  if (body.h !== quoteHash(cart) || body.t !== cart.totalPaise) return "Prices changed since the quote.";
  return null;
}

// ── API shape ────────────────────────────────────────────────────────────────

export function toQuoteResponse(cart: PricedCart, userId: string | null) {
  const { quoteId, expiresAt } = signQuote(cart, userId);
  const r = paiseToRupees;
  const discountsTotal = cart.couponPaise + cart.cashbackPaise + cart.ciPointsPaise;
  return {
    quote_id: quoteId,
    quote_hash: quoteHash(cart),
    expires_at: expiresAt.toISOString(),
    currency: "INR",
    delivery_option: cart.deliveryOption,
    lines: cart.lines.map((l) => ({
      product_id: l.productId,
      variant_id: l.variantId,
      variant: l.variantLabel,
      name: l.name,
      brand: l.brand,
      seller_id: l.sellerId,
      qty: l.qty,
      unit_price: r(l.unitPricePaise),
      unit_price_paise: l.unitPricePaise,
      mrp: l.mrpPaise !== null ? r(l.mrpPaise) : null,
      line_total: r(l.lineTotalPaise),
      line_total_paise: l.lineTotalPaise,
      line_mrp_total: r(l.lineMrpTotalPaise),
      mrp_savings: r(l.lineMrpTotalPaise - l.lineTotalPaise),
    })),
    subtotal: r(cart.subtotalPaise),
    subtotal_paise: cart.subtotalPaise,
    mrp_total: r(cart.mrpTotalPaise),
    mrp_savings: r(cart.mrpTotalPaise - cart.subtotalPaise),
    discounts: {
      coupon: r(cart.couponPaise),
      cashback: r(cart.cashbackPaise),
      ci_points: r(cart.ciPointsPaise),
      total: r(discountsTotal),
      total_paise: discountsTotal,
    },
    fees: {
      express_delivery_fee: r(cart.expressFeePaise),
      platform_fee: r(cart.platformFeePaise),
      platform_fee_gst: r(cart.platformFeeGstPaise),
      platform_fee_total: r(cart.platformFeePaise + cart.platformFeeGstPaise),
    },
    exchange: cart.exchange
      ? {
          order_id: cart.exchange.orderId,
          order_number: cart.exchange.orderNumber,
          credit: r(cart.exchange.creditPaise),
          refund_due: r(cart.exchange.refundDuePaise),
        }
      : null,
    cashback_balance: cart.cashbackBalancePaise !== null ? r(cart.cashbackBalancePaise) : null,
    total: r(cart.totalPaise),
    total_paise: cart.totalPaise,
    requires_payment: cart.totalPaise > 0,
    notes: cart.notes,
  };
}

/** What we keep on the RazorpayCheckout snapshot: everything fulfilment needs, nothing from the client. */
export function toPricingSnapshot(cart: PricedCart) {
  return {
    version: 1,
    quote_hash: quoteHash(cart),
    delivery_option: cart.deliveryOption,
    lines: cart.lines,
    subtotal_paise: cart.subtotalPaise,
    cashback_paise: cart.cashbackPaise,
    coupon_paise: cart.couponPaise,
    express_fee_paise: cart.expressFeePaise,
    platform_fee_paise: cart.platformFeePaise + cart.platformFeeGstPaise,
    exchange: cart.exchange,
    total_paise: cart.totalPaise,
  };
}

export type PricingSnapshot = ReturnType<typeof toPricingSnapshot>;
