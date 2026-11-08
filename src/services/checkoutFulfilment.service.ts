/**
 * Fulfilment of a confirmed Razorpay checkout (spec 003 §3–§5).
 *
 * Phase 1 (one Prisma transaction): stock, Order + OrderItem per server-priced line (linked to
 * the buyer), Settlement per line (PENDING_TRANSFER), wallet debits, checkout stage
 * DB_COMMITTED. All or nothing — a failed line fails the whole cart.
 * Phase 2 (after commit): Route transfer per settlement, with status tracking. Resumable:
 * transfers already made for the payment are adopted instead of repeated.
 *
 * Business failures throw FulfilmentRejection; razorpayCheckoutService.fulfilOnce refunds.
 */
import { prisma } from "../config/prisma";
import { NotificationType, OrderStatus, Prisma, WalletTxType } from "../generated/prisma/client";
import { FulfilmentRejection, RazorpayCheckoutRow } from "./razorpayCheckout.service";
import {
  CUSTOMER_PLATFORM_FEE_TOTAL_PAISE,
  EXPRESS_DELIVERY_FEE_PAISE,
  MALL_CHARGES_PLATFORM_FEE,
  PricingError,
  PricingSnapshot,
  decimalToPaise,
  paiseToRupees,
  parsePricingRequest,
  priceCart,
  priceLines,
  sellerLinkedAccount,
  toPricingSnapshot,
} from "./mallPricing.service";
import { calculateSettlementBreakdown, SettlementLedgerBreakdown } from "./settlementCalculator.service";
import { getSellerSettlementProfile, SellerSettlementProfile } from "./settlement.service";
import { razorpayRouteService, RazorpayTransferEntity } from "./razorpayRoute.service";
import { InsufficientBalanceError, walletService, Tx } from "./wallet.service";
import { RewardsCalcService } from "./rewardsCalc.service";
import { executeExchange, ExchangeError } from "./returns.service";

/** Non-money delivery details recorded with the checkout. */
export const SHIPPING_FIELDS = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "delivery_address",
  "pincode",
  "city",
  "carrier_name",
] as const;

export function pickShipping(body: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SHIPPING_FIELDS) {
    const v = body?.[key];
    if (v !== undefined && v !== null && v !== "" && typeof v !== "object") out[key] = String(v).slice(0, 500);
  }
  return out;
}

function shippingOf(snap: any, fallbackBody?: any): Record<string, string> {
  return { ...pickShipping(fallbackBody), ...pickShipping(snap), ...pickShipping(snap?.shipping) };
}

const TX_OPTIONS = { timeout: 20000, maxWait: 10000 } as const;

function settlementData(
  breakdown: SettlementLedgerBreakdown,
  extra: { sellerId: string; orderId: string; orderNumber: string; category: string; paymentId: string; holdDays: number; ledger?: Record<string, unknown> }
): Prisma.SettlementUncheckedCreateInput {
  const holdUntil = new Date(Date.now() + extra.holdDays * 86400000);
  return {
    sellerId: extra.sellerId,
    orderId: extra.orderId,
    orderNumber: extra.orderNumber,
    periodStart: new Date(),
    periodEnd: new Date(),
    category: extra.category,
    grossSales: breakdown.grossProductValue,
    basePrice: breakdown.baseProductValue,
    gstOnSale: breakdown.productGst,
    commissionRate: breakdown.commissionRate,
    commissionAmount: breakdown.commission,
    gstOnCommission: breakdown.commissionGst,
    commissionTotal: breakdown.commissionTotal,
    shippingFee: breakdown.shipping,
    shippingGst: breakdown.shippingGst,
    shippingTotal: breakdown.shippingTotal,
    sellerPlatformFee: breakdown.sellerPlatformFee,
    sellerPlatformFeeGst: breakdown.sellerPlatformFeeGst,
    sellerPlatformTotal: breakdown.sellerPlatformTotal,
    tdsAmount: breakdown.tds,
    tcsAmount: breakdown.tcs,
    statutoryTaxes: breakdown.tds + breakdown.tcs,
    successFeeAmount: breakdown.successFee,
    successFeeGst: breakdown.successFeeGst,
    successFeeTotal: breakdown.successFeeTotal,
    customerPlatformFee: breakdown.customerPlatformFee,
    customerPlatformFeeGst: breakdown.customerPlatformFeeGst,
    customerPlatformTotal: breakdown.customerPlatformTotal,
    customerTotalPayment: breakdown.customerTotalPayment,
    cikkaFeeRevenue: breakdown.cikkaFeeRevenue,
    cikkaGstCollected: breakdown.cikkaGstCollected,
    totalDeductions: breakdown.totalSellerDeductions,
    netPayable: breakdown.sellerNetSettlement,
    status: "PENDING",
    transferStatus: "PENDING_TRANSFER",
    razorpayPaymentId: extra.paymentId,
    holdUntil,
    payoutDate: holdUntil,
    ledgerBreakdown: JSON.parse(JSON.stringify({ ...breakdown, ...(extra.ledger || {}) })),
  };
}

/** Stock is decremented only if enough is left (conditional update); otherwise reject. */
async function takeStock(tx: Tx, line: { productId: string; variantId: string | null; qty: number; name: string }) {
  const res = line.variantId
    ? await tx.productVariant.updateMany({
        where: { id: line.variantId, productId: line.productId, stockQty: { gte: line.qty } },
        data: { stockQty: { decrement: line.qty } },
      })
    : await tx.product.updateMany({
        where: { id: line.productId, status: "ACTIVE", stockQty: { gte: line.qty } },
        data: { stockQty: { decrement: line.qty } },
      });
  if (res.count === 0) {
    throw new FulfilmentRejection("INSUFFICIENT_STOCK", `${line.name} sold out before your payment completed.`, {
      productId: line.productId,
    });
  }
}

async function existingUserId(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user?.id ?? null;
}

/** Run a fulfilment transaction, turning wallet shortfalls into a rejection (→ refund). */
async function runFulfilmentTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, TX_OPTIONS);
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      throw new FulfilmentRejection(
        err.balance === "POINTS" ? "INSUFFICIENT_POINTS" : "INSUFFICIENT_CASHBACK",
        err.balance === "POINTS"
          ? "You no longer have enough CI Points for this redemption."
          : "Your cashback balance changed before the payment completed."
      );
    }
    throw err;
  }
}

// ── Phase 2: Route transfers (after commit, resumable) ───────────────────────

function transferNote(t: RazorpayTransferEntity, key: string): string | undefined {
  const notes = t.notes;
  if (!notes || Array.isArray(notes)) return undefined;
  return (notes as Record<string, string>)[key];
}

/**
 * Transfer each seller share recorded for this payment that has no transfer yet.
 * Safe to call repeatedly (admin resume): transfers Razorpay already has for the payment are
 * matched by `notes.orderNumber` and adopted instead of being created again.
 */
export async function completeTransfers(razorpayOrderId: string, paymentId: string) {
  const pending = await prisma.settlement.findMany({
    where: {
      razorpayPaymentId: paymentId,
      razorpayTransferId: null,
      status: "PENDING",
      transferStatus: { in: ["PENDING_TRANSFER", "TRANSFER_FAILED"] },
    },
    include: { seller: { include: { onboarding: true } } },
    orderBy: { orderNumber: "asc" },
  });
  const outcomes: Array<{ settlementId: string; orderNumber: string | null; transferId?: string; status: string; error?: string }> = [];
  if (pending.length === 0) {
    await prisma.razorpayCheckout.updateMany({ where: { razorpayOrderId, stage: "DB_COMMITTED" }, data: { stage: "COMPLETED" } });
    return outcomes;
  }

  let existing: RazorpayTransferEntity[] = [];
  try {
    existing = await razorpayRouteService.fetchPaymentTransfers(paymentId);
  } catch (err: any) {
    // Without the list we cannot rule out a transfer made before a crash: leave them pending.
    console.warn(`[Fulfilment] Could not list transfers for ${paymentId}: ${err.message}; transfers left pending`);
    return pending.map((s) => ({ settlementId: s.id, orderNumber: s.orderNumber, status: "PENDING_TRANSFER", error: err.message }));
  }

  for (const s of pending) {
    const account = sellerLinkedAccount(s.seller);
    const amountPaise = decimalToPaise(s.netPayable);
    const adopted = existing.find((t) => transferNote(t, "orderNumber") === s.orderNumber && (!account || t.recipient === account));

    if (adopted) {
      await prisma.settlement.update({
        where: { id: s.id },
        data: { razorpayTransferId: adopted.id, transferStatus: adopted.on_hold === false ? "SETTLED" : "ON_HOLD", failureReason: null },
      });
      outcomes.push({ settlementId: s.id, orderNumber: s.orderNumber, transferId: adopted.id, status: "ADOPTED" });
      continue;
    }
    if (amountPaise <= 0) {
      await prisma.settlement.update({ where: { id: s.id }, data: { transferStatus: "NOT_REQUIRED" } });
      outcomes.push({ settlementId: s.id, orderNumber: s.orderNumber, status: "NOT_REQUIRED" });
      continue;
    }
    if (!account) {
      const reason = "Seller has no active Razorpay linked account; payout held for ops";
      await prisma.settlement.update({ where: { id: s.id }, data: { transferStatus: "TRANSFER_FAILED", failureReason: reason } });
      outcomes.push({ settlementId: s.id, orderNumber: s.orderNumber, status: "TRANSFER_FAILED", error: reason });
      continue;
    }

    const profile = await getSellerSettlementProfile(s.sellerId, s.category);
    const ledger = (s.ledgerBreakdown || {}) as Record<string, any>;
    const result = await razorpayRouteService
      .transferPaymentWithT7Hold({
        paymentId,
        sellerAccountId: account,
        amountInPaise: amountPaise,
        holdDays: profile.holdDays,
        notes: {
          orderNumber: s.orderNumber || "",
          settlementId: s.id,
          sellerId: s.sellerId,
          category: s.category,
          commissionRate: `${profile.commissionRate}%`,
          grossSales: Number(s.grossSales).toFixed(2),
          netPayable: Number(s.netPayable).toFixed(2),
          isExpress: String(Boolean(ledger.isExpress)),
        },
      })
      .catch((err: any) => ({ success: false as const, error: err.message as string, transferId: undefined, onHold: undefined, holdUntil: undefined }));

    if (result.success && result.transferId) {
      await prisma.settlement.update({
        where: { id: s.id },
        data: {
          razorpayTransferId: result.transferId,
          transferStatus: result.onHold ? "ON_HOLD" : "SETTLED",
          holdUntil: result.holdUntil ?? undefined,
          payoutDate: result.holdUntil ?? undefined,
          failureReason: null,
        },
      });
      await prisma.notification
        .create({
          data: {
            sellerId: s.sellerId,
            type: NotificationType.SETTLEMENT,
            title: `T+${profile.holdDays} Payout Scheduled: ₹${Number(s.netPayable).toFixed(2)}`,
            body: `Net settlement for order #${s.orderNumber} transferred to your Razorpay Linked Account on T+${profile.holdDays} hold.`,
            metadata: { orderNumber: s.orderNumber, transferId: result.transferId },
          },
        })
        .catch(() => {});
      outcomes.push({ settlementId: s.id, orderNumber: s.orderNumber, transferId: result.transferId, status: "TRANSFERRED" });
    } else {
      const error = (result as any).error || "Route transfer failed";
      await prisma.settlement.update({ where: { id: s.id }, data: { transferStatus: "TRANSFER_FAILED", failureReason: error.slice(0, 500) } });
      outcomes.push({ settlementId: s.id, orderNumber: s.orderNumber, status: "TRANSFER_FAILED", error });
    }
  }

  if (outcomes.every((o) => o.status !== "TRANSFER_FAILED" && o.status !== "PENDING_TRANSFER")) {
    await prisma.razorpayCheckout.updateMany({ where: { razorpayOrderId }, data: { stage: "COMPLETED" } });
  }
  return outcomes;
}

// ── Mall ─────────────────────────────────────────────────────────────────────

/** Server pricing recorded at create-order; legacy rows are repriced from their product ids. */
async function pricingFor(checkout: RazorpayCheckoutRow): Promise<PricingSnapshot> {
  const snap = (checkout.snapshot || {}) as Record<string, any>;
  if (snap.pricing && Array.isArray(snap.pricing.lines)) return snap.pricing as PricingSnapshot;

  if (!Array.isArray(snap.items) || snap.items.length === 0) {
    throw new FulfilmentRejection("NO_CART", "No cart was recorded for this payment.");
  }
  try {
    // Pre-spec-003 checkout: the client prices in the snapshot are ignored; product ids and
    // quantities are priced from the DB and must add up to what was actually paid.
    const cart = await priceCart(parsePricingRequest({ items: snap.items, delivery_option: snap.delivery_option }), null);
    return toPricingSnapshot(cart);
  } catch (err) {
    if (err instanceof PricingError) throw new FulfilmentRejection(err.code, err.message, err.details);
    throw err;
  }
}

async function commitMallOrders(checkout: RazorpayCheckoutRow, paymentId: string, pricing: PricingSnapshot) {
  const snap = (checkout.snapshot || {}) as Record<string, any>;
  const shipping = shippingOf(snap);
  const userId = await existingUserId(checkout.userId);
  if (pricing.cashback_paise > 0 && !userId) {
    throw new FulfilmentRejection("AUTH_REQUIRED_FOR_CASHBACK", "Cashback was applied but no signed-in buyer is recorded.");
  }

  const isExpress = pricing.delivery_option === "express";
  const distinctSellers = new Set(pricing.lines.map((l) => l.sellerId));
  const isSameBrandExpress = isExpress && distinctSellers.size <= 1;
  const profiles = new Map<string, SellerSettlementProfile>();
  for (const line of pricing.lines) {
    const key = `${line.sellerId}:${line.category || ""}`;
    if (!profiles.has(key)) profiles.set(key, await getSellerSettlementProfile(line.sellerId, line.category || undefined));
  }

  const multi = pricing.lines.length > 1;
  const city = shipping.city || "";
  const pincode = shipping.pincode || "";
  const carrier = isExpress ? "Delhivery Express Air (24-48h)" : shipping.carrier_name || "Delhivery (0.5kg)";

  await runFulfilmentTx(async (tx) => {
    let idx = 1;
    for (const line of pricing.lines) {
      const product = await tx.product.findUnique({ where: { id: line.productId }, select: { id: true, sellerId: true, status: true } });
      if (!product || product.status !== "ACTIVE") {
        throw new FulfilmentRejection("PRODUCT_UNAVAILABLE", `${line.name} is no longer available.`, { productId: line.productId });
      }
      if (product.sellerId !== line.sellerId) {
        throw new FulfilmentRejection("SELLER_CHANGED", `${line.name} changed seller; please order again.`, { productId: line.productId });
      }
      await takeStock(tx, line);

      const orderNumber = multi ? `${checkout.razorpayOrderId}-${idx}` : checkout.razorpayOrderId;
      const lineRupees = paiseToRupees(line.lineTotalPaise);
      const order = await tx.order.create({
        data: {
          sellerId: line.sellerId,
          userId,
          orderNumber,
          customerName: shipping.customer_name || "Cikka Mall Customer",
          customerCity: city ? `${city}${pincode ? ` (${pincode})` : ""}` : pincode || null,
          totalAmount: lineRupees.toFixed(2),
          status: OrderStatus.PENDING,
          courier: carrier,
          items: {
            create: [
              {
                productId: line.productId,
                variantId: line.variantId,
                quantity: line.qty,
                unitPrice: paiseToRupees(line.unitPricePaise).toFixed(2),
              },
            ],
          },
        },
      });

      const profile = profiles.get(`${line.sellerId}:${line.category || ""}`)!;
      const breakdown = calculateSettlementBreakdown(
        lineRupees,
        { ...profile.customConfig, customerPlatformFee: MALL_CHARGES_PLATFORM_FEE ? 9.99 : 0 },
        1,
        { isExpress, isSameBrandExpress, isPrimarySubOrder: idx === 1 }
      );
      await tx.settlement.create({
        data: settlementData(breakdown, {
          sellerId: line.sellerId,
          orderId: order.id,
          orderNumber,
          category: line.category || "Cikka Mall Marketplace",
          paymentId,
          holdDays: profile.holdDays,
          ledger: { productId: line.productId, qty: line.qty, unitPricePaise: line.unitPricePaise, razorpayOrderId: checkout.razorpayOrderId },
        }),
      });
      await tx.notification.create({
        data: {
          sellerId: line.sellerId,
          type: NotificationType.ORDER,
          title: `New Order: #${orderNumber}`,
          body: `New prepaid order for ${line.qty} × ${line.name} (₹${lineRupees.toFixed(2)}). Assigned to ${carrier}. Please pack the order to generate the shipping label.`,
          metadata: { orderNumber, courier: carrier },
        },
      });
      idx += 1;
    }

    if (pricing.cashback_paise > 0 && userId) {
      await walletService.applyEntryTx(tx, {
        userId,
        txType: WalletTxType.CASHBACK_REDEEM,
        cashPaiseDelta: -pricing.cashback_paise,
        idempotencyKey: `CASHBACK_REDEEM:${checkout.razorpayOrderId}`,
        orderId: checkout.razorpayOrderId,
        razorpayPaymentId: paymentId,
        description: `Cashback applied to mall order ${checkout.razorpayOrderId}`,
      });
    }

    await tx.razorpayCheckout.update({ where: { razorpayOrderId: checkout.razorpayOrderId }, data: { stage: "DB_COMMITTED" } });
  });
}

/**
 * Fulfil a confirmed mall payment from the server-priced snapshot. The paid amount (from
 * Razorpay) must equal the priced total; client prices are never read.
 */
export async function fulfilMallCheckout(checkout: RazorpayCheckoutRow, paymentId: string, amountPaise: number) {
  const pricing = await pricingFor(checkout);
  if (pricing.total_paise !== amountPaise) {
    throw new FulfilmentRejection("AMOUNT_MISMATCH", "The amount paid does not match the order total.", {
      paid_paise: amountPaise,
      expected_paise: pricing.total_paise,
    });
  }

  if (pricing.exchange) return fulfilExchangeCheckout(checkout, paymentId, amountPaise, pricing);

  if (checkout.stage !== "DB_COMMITTED" && checkout.stage !== "COMPLETED") {
    await commitMallOrders(checkout, paymentId, pricing);
  }
  const transfers = await completeTransfers(checkout.razorpayOrderId, paymentId);

  const orders = await prisma.order.findMany({
    where: { OR: [{ orderNumber: checkout.razorpayOrderId }, { orderNumber: { startsWith: `${checkout.razorpayOrderId}-` } }] },
    include: { items: true, seller: { select: { isSpecialSeller: true } }, settlements: true },
    orderBy: { orderNumber: "asc" },
  });
  const hasSpecialSeller = orders.some((o) => o.seller?.isSpecialSeller);
  const rewards = RewardsCalcService.calculateMallPurchaseRewards(amountPaise / 100, hasSpecialSeller);

  return {
    payment_id: paymentId,
    order_id: checkout.razorpayOrderId,
    amount_paid_paise: amountPaise,
    pricing: {
      subtotal: paiseToRupees(pricing.subtotal_paise),
      cashback: paiseToRupees(pricing.cashback_paise),
      express_delivery_fee: paiseToRupees(pricing.express_fee_paise),
      total: paiseToRupees(pricing.total_paise),
    },
    cashback_earned: rewards.cashbackEarned,
    ci_points_earned: rewards.ciPointsEarned,
    is_special_seller: rewards.isSpecialSeller,
    cashback_multiplier: rewards.cashbackMultiplier,
    rewards_status: rewards.status,
    processed_orders: orders.map((o) => {
      const settlement = o.settlements[0];
      return {
        order_number: o.orderNumber,
        awb: o.trackingNumber,
        courier: o.courier,
        seller_id: o.sellerId,
        is_special_seller: Boolean(o.seller?.isSpecialSeller),
        product_id: o.items[0]?.productId,
        qty: o.items[0]?.quantity,
        unit_price: Number(o.items[0]?.unitPrice ?? 0),
        line_total: Number(o.totalAmount),
        transfer_id: settlement?.razorpayTransferId ?? undefined,
        transfer_status: settlement?.transferStatus ?? undefined,
        settlement_id: settlement?.id,
        net_payable: settlement ? Number(settlement.netPayable) : undefined,
      };
    }),
    transfers,
  };
}

/** Paid exchange upgrade: re-check eligibility, then file the exchange (no new mall order). */
async function fulfilExchangeCheckout(checkout: RazorpayCheckoutRow, paymentId: string, amountPaise: number, pricing: PricingSnapshot) {
  const line = pricing.lines[0];
  try {
    const result = await executeExchange({
      userId: checkout.userId,
      orderId: pricing.exchange!.orderId,
      newProductId: line.productId,
      newVariantId: line.variantId,
      reason: "Customer paid upgrade exchange via Cikka Mall",
      paidDelta: { paymentId, amountPaise: amountPaise - pricing.express_fee_paise },
    });
    return {
      payment_id: paymentId,
      order_id: checkout.razorpayOrderId,
      amount_paid_paise: amountPaise,
      exchange: {
        order_number: pricing.exchange!.orderNumber,
        return_id: result.ret.id,
        routing: result.routingSummary,
        reverse_awb: result.reverseDetails?.reverseAwb ?? null,
      },
      cashback_earned: 0,
      ci_points_earned: 0,
      processed_orders: [],
    };
  } catch (err) {
    if (err instanceof ExchangeError) throw new FulfilmentRejection("EXCHANGE_NOT_ELIGIBLE", err.message, err.details);
    throw err;
  }
}

// ── Rewards Store redemption ─────────────────────────────────────────────────

/** Redemption fee in paise: ₹11.79 platform fee (+ ₹50 express). */
export function expectedRewardsFeePaise(isExpress: boolean): number {
  return CUSTOMER_PLATFORM_FEE_TOTAL_PAISE + (isExpress ? EXPRESS_DELIVERY_FEE_PAISE : 0);
}

export interface RewardSnapshot {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  product_value_paise: number;
  points: number;
  seller_id: string;
  category: string | null;
  is_express: boolean;
  fee_paise: number;
}

export function rewardsOrderNumber(razorpayOrderId: string) {
  return `ORD-RW-${razorpayOrderId.replace(/^order_/, "")}`;
}

/**
 * Fulfil a confirmed rewards payment: what is redeemed (product, value, points) is the
 * server snapshot from initiate-redemption; only delivery details may come from the request.
 * Points are debited through the ledger in the same transaction as the order.
 */
export async function fulfilRewardsCheckout(checkout: RazorpayCheckoutRow, paymentId: string, amountPaise: number, requestBody?: any) {
  const snap = (checkout.snapshot || {}) as Record<string, any>;
  const reward = snap.reward as RewardSnapshot | undefined;
  if (!reward) {
    throw new FulfilmentRejection("UNKNOWN_PRODUCT", "This redemption was not priced by the server; please start again.");
  }
  if (amountPaise !== expectedRewardsFeePaise(reward.is_express)) {
    throw new FulfilmentRejection("AMOUNT_MISMATCH", "Paid amount does not match the redemption fee.");
  }
  const userId = await existingUserId(checkout.userId);
  if (!userId) throw new FulfilmentRejection("AUTH_REQUIRED", "Please sign in to redeem CI Points.");

  const shipping = shippingOf(snap, requestBody);
  const orderNumber = rewardsOrderNumber(checkout.razorpayOrderId);
  const redemptionId = `RDM-${checkout.razorpayOrderId.replace(/^order_/, "")}`;
  const carrier = shipping.carrier_name || (reward.is_express ? "Delhivery Express Air (24-48h)" : "Delhivery 3PL Express (0.5kg)");
  const productValue = paiseToRupees(reward.product_value_paise);
  const feeRupees = paiseToRupees(reward.fee_paise);
  const expressFee = reward.is_express ? paiseToRupees(EXPRESS_DELIVERY_FEE_PAISE) : 0;

  if (checkout.stage !== "DB_COMMITTED" && checkout.stage !== "COMPLETED") {
    const profile = await getSellerSettlementProfile(reward.seller_id, reward.category || "Rewards");
    await runFulfilmentTx(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: reward.product_id }, select: { sellerId: true, status: true } });
      if (!product || product.status !== "ACTIVE" || product.sellerId !== reward.seller_id) {
        throw new FulfilmentRejection("PRODUCT_UNAVAILABLE", `${reward.product_name} is no longer available.`);
      }
      await takeStock(tx, { productId: reward.product_id, variantId: reward.variant_id, qty: 1, name: reward.product_name });

      await walletService.applyEntryTx(tx, {
        userId,
        txType: WalletTxType.REDEEM_REWARD,
        pointsDelta: -reward.points,
        idempotencyKey: `REDEEM_REWARD:${checkout.razorpayOrderId}`,
        redemptionId,
        orderId: orderNumber,
        razorpayPaymentId: paymentId,
        description: `Rewards Store redemption: ${reward.product_name}`,
      });

      const order = await tx.order.create({
        data: {
          sellerId: reward.seller_id,
          userId,
          orderNumber,
          customerName: `${shipping.customer_name || "Cikka Member"} (${redemptionId})`,
          customerCity: shipping.city ? `${shipping.city}${shipping.pincode ? ` (${shipping.pincode})` : ""}` : shipping.pincode || null,
          totalAmount: productValue.toFixed(2),
          status: OrderStatus.PENDING,
          courier: carrier,
          items: {
            create: [
              { productId: reward.product_id, variantId: reward.variant_id, quantity: 1, unitPrice: productValue.toFixed(2) },
            ],
          },
        },
      });

      const breakdown = calculateSettlementBreakdown(productValue, profile.customConfig);
      await tx.settlement.create({
        data: {
          ...settlementData(breakdown, {
            sellerId: reward.seller_id,
            orderId: order.id,
            orderNumber,
            category: "Rewards Store Redemption",
            paymentId,
            holdDays: profile.holdDays,
            ledger: {
              redemptionId,
              fundingSource: "CIKKA_REWARDS_TREASURY",
              pointsBurned: reward.points,
              customerFeePaid: feeRupees,
              expressFee,
              isExpress: reward.is_express,
            },
          }),
          customerTotalPayment: feeRupees,
          cikkaFeeRevenue: Number((breakdown.cikkaFeeRevenue + expressFee).toFixed(2)),
        },
      });
      await tx.notification.create({
        data: {
          sellerId: reward.seller_id,
          type: NotificationType.ORDER,
          title: `Rewards Store Order: #${orderNumber}`,
          body: `Prepaid by Cikka via CI Points Redemption (${redemptionId}). Mode: ${reward.is_express ? "Express 2-Day" : "Standard"}. Please pack the order to generate the shipping label.`,
          metadata: { orderNumber, redemptionNumber: redemptionId, courier: carrier, isExpress: reward.is_express },
        },
      });
      await tx.razorpayCheckout.update({ where: { razorpayOrderId: checkout.razorpayOrderId }, data: { stage: "DB_COMMITTED" } });
    });
  }

  await completeTransfers(checkout.razorpayOrderId, paymentId);

  const settlement = await prisma.settlement.findFirst({ where: { orderNumber } });
  const ledgerEntry = await prisma.loyaltyLedger.findUnique({ where: { idempotencyKey: `REDEEM_REWARD:${checkout.razorpayOrderId}` } });
  return {
    order_id: orderNumber,
    redemption_id: redemptionId,
    customer_payment_id: paymentId,
    customer_fee_paid: feeRupees,
    points_burned: reward.points,
    product_id: reward.product_id,
    product_value: productValue,
    is_express: reward.is_express,
    cashback_earned: 0,
    points_earned: 0,
    net_seller_payout: settlement ? Number(settlement.netPayable) : 0,
    cikka_retained_earnings: settlement ? Number(settlement.cikkaFeeRevenue) : 0,
    transfer_id: settlement?.razorpayTransferId ?? undefined,
    transfer_status: settlement?.transferStatus ?? undefined,
    settlement_id: settlement?.id,
    hold_until: settlement?.holdUntil,
    awb: null,
    courier: carrier,
    tracking_url: `/api/shipway/tracking/${orderNumber}`,
    wallet: ledgerEntry
      ? {
          balance_after_points: ledgerEntry.balanceAfterPoints,
          balance_after_cash_rupees: ledgerEntry.balanceAfterPaise / 100,
          ledger_entry_id: ledgerEntry.id,
        }
      : null,
  };
}

/**
 * Server price of a Rewards Store redemption: an ACTIVE DB product, 1 CI Point = ₹1 of its
 * price (rounded, as the app shows `Math.round(price)` pts), fee ₹11.79 (+ ₹50 express).
 */
export async function priceReward(productId: string, variantId: string | null, isExpress: boolean): Promise<RewardSnapshot> {
  const [line] = await priceLines([{ productId, variantId, qty: 1 }]);
  return {
    product_id: line.productId,
    variant_id: line.variantId,
    product_name: line.name,
    product_value_paise: line.unitPricePaise,
    points: Math.round(line.unitPricePaise / 100),
    seller_id: line.sellerId,
    category: line.category,
    is_express: isExpress,
    fee_paise: expectedRewardsFeePaise(isExpress),
  };
}
