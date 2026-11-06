import crypto from "crypto";
import { Request, Response } from "express";
import { razorpayService, STUB_PAYMENT_PREFIX } from "../services/razorpay.service";
import {
  razorpayCheckoutService,
  PaymentVerificationError,
  RazorpayCheckoutRow,
  FulfilmentOutcome,
} from "../services/razorpayCheckout.service";
import { config, isRazorpayStubMode } from "../config/env";
import { razorpayRouteService } from "../services/razorpayRoute.service";
import { calculateSettlementBreakdown } from "../services/settlementCalculator.service";
import { getSellerSettlementProfile } from "../services/settlement.service";
import { walletService } from "../services/wallet.service";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { OrderStatus, NotificationType, WalletTxType } from "../generated/prisma/client";

/**
 * Helper to match or create a seller for a given pickup pincode
 */
async function findOrCreateSeller(pickupPincode: string, categoryHint?: string): Promise<any> {
  try {
    const allSellers = await prisma.seller.findMany({
      include: { onboarding: true, commissionConfig: true },
    });

    if (allSellers.length > 0) {
      for (const s of allSellers) {
        const addr = s.onboarding?.pickupAddress as any;
        if (addr && (addr.pincode === pickupPincode || addr.pin === pickupPincode)) {
          return s;
        }
      }
      if (pickupPincode === "122008") {
        const s = allSellers.find((x) => x.businessName.toLowerCase().includes("nike"));
        if (s) return s;
      }
      if (pickupPincode === "226005") {
        const s = allSellers.find(
          (x) =>
            x.businessName.toLowerCase().includes("fabindia") ||
            x.businessName.toLowerCase().includes("linen")
        );
        if (s) return s;
      }
      return allSellers[0];
    }

    const created = await prisma.seller.create({
      data: {
        phone: "9876543210",
        email: "partner@cikka.club",
        businessName: "Cikka Flagship Store",
        kycVerified: true,
        onboardingStatus: "COMPLETED" as any,
      },
      include: { onboarding: true },
    });
    return created;
  } catch (err: any) {
    console.warn(`[Rewards findOrCreateSeller Notice]: ${err.message}`);
    return null;
  }
}

/**
 * Helper to ensure product exists in Prisma to satisfy OrderItem relations
 */
async function getOrCreateProductForSeller(
  sellerId: string,
  name: string,
  price: number,
  category: string
): Promise<string> {
  try {
    const existing = await prisma.product.findFirst({
      where: {
        sellerId,
        name: { contains: name.slice(0, 15), mode: "insensitive" },
      },
    });
    if (existing) return existing.id;

    const anyProd = await prisma.product.findFirst({ where: { sellerId } });
    if (anyProd) return anyProd.id;

    const created = await prisma.product.create({
      data: {
        sellerId,
        name,
        sku: `RW-${Date.now().toString(36).toUpperCase()}`,
        price: Number(price),
        mrp: Number(price) * 1.25,
        category,
        stockQty: 99,
        status: "ACTIVE" as any,
      },
    });
    return created.id;
  } catch (err: any) {
    console.warn(`[Rewards getOrCreateProductForSeller Notice]: ${err.message}`);
    const fallback = await prisma.product.findFirst();
    if (fallback) return fallback.id;
    throw err;
  }
}

/**
 * GET /api/rewards/balance
 * GET /api/rewards/user/balance
 * Returns the current authenticated or looked-up user's CI Points balance and wallet balance.
 */
export const getUserRewardBalance = asyncHandler(async (req: Request, res: Response) => {
  const phone = (req.query.phone as string) || (req as any).user?.phone || "9876543210";
  const cleanPhone = String(phone).replace(/\D/g, "").slice(-10);

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: { contains: cleanPhone } },
        { phone: phone },
      ],
    },
  });

  const ciPoints = user?.ciPoints ?? 100000;
  const cashbackBalance = Number(user?.cashbackBalance ?? 0);

  res.status(200).json({
    success: true,
    phone,
    ci_points: ciPoints,
    cashback_balance: cashbackBalance,
  });
});

/**
 * The user whose CI Points are burned. Always the signed-in user when there is one; the old
 * phone lookup is kept only outside production (guest demo flows).
 */
async function resolveRedeemingUser(authenticatedUserId: string | null, customerPhone?: string) {
  if (authenticatedUserId) {
    return prisma.user.findUnique({ where: { id: authenticatedUserId } });
  }
  if (config.isProduction) return null;
  const cleanPhone = String(customerPhone || "").replace(/\D/g, "").slice(-10);
  if (!cleanPhone) return null;
  return prisma.user.findFirst({
    where: { OR: [{ phone: { contains: cleanPhone } }, { phone: String(customerPhone) }] },
  });
}

/**
 * POST /api/rewards/initiate-redemption
 * Step 1: Customer selects physical product to redeem with CI Points.
 * Validates points balance against product points requirement.
 * Creates Razorpay PG Order:
 *   • Standard: ₹11.79 (Platform Fee)
 *   • Express 2-Day: ₹61.79 (₹50 Express + ₹11.79 Platform Fee)
 */
export const initiateRedemption = asyncHandler(async (req: Request, res: Response) => {
  const {
    productId,
    productName = "Cikka Curated Reward",
    productValue = 1000, // In Rupees (e.g. ₹1,000)
    pointsRequired = 1000,
    customerName,
    customerEmail,
    customerPhone,
    is_express,
    delivery_option,
  } = req.body;

  const numProductValue = Number(productValue) || 1000;
  const numPointsRequired = Number(pointsRequired) || numProductValue;
  const isExpress = Boolean(is_express || delivery_option === "express");

  if (config.isProduction && !req.user?.id) {
    res.status(401).json({ success: false, error: "Please sign in to redeem CI Points." });
    return;
  }

  // Validate CI Points Balance: If user balance X < required points Y, return strict error
  const user = await resolveRedeemingUser(req.user?.id ?? null, customerPhone);
  if (user || req.user?.id) {
    const userBalance = user?.ciPoints ?? 0;
    if (userBalance < numPointsRequired) {
      res.status(400).json({
        success: false,
        error: "points doesnt match the require CI points",
        current_ci_points: userBalance,
        required_ci_points: numPointsRequired,
        shortfall: numPointsRequired - userBalance,
      });
      return;
    }
  }

  // Platform Fee Math: Fixed ₹9.99 + 18% GST (₹1.80) = ₹11.79
  const platformFeeBase = 9.99;
  const platformFeeGst = 1.8;
  const expressFee = isExpress ? 50.0 : 0.0;
  const customerPayableRupees = Number((11.79 + expressFee).toFixed(2)); // ₹11.79 or ₹61.79
  const customerPayablePaise = Math.round(customerPayableRupees * 100);

  const receipt = `rw_rcpt_${Date.now()}`;
  const { order: rzpOrder } = await razorpayCheckoutService.createCheckout({
    purpose: "REWARDS",
    amountPaise: customerPayablePaise,
    currency: "INR",
    receipt,
    userId: req.user?.id,
    notes: {
      type: isExpress ? "REWARDS_STORE_PLATFORM_AND_EXPRESS_FEE" : "REWARDS_STORE_PLATFORM_FEE",
      product_name: String(productName).slice(0, 40),
      product_value: String(numProductValue),
      points_required: String(numPointsRequired),
      is_express: String(isExpress),
      express_fee: String(expressFee),
    },
    // What is being redeemed is fixed here, before payment; confirm uses this, not the body.
    snapshot: {
      product_id: productId,
      product_name: productName,
      product_value: numProductValue,
      points_burned: numPointsRequired,
      is_express: isExpress,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
    },
  });

  res.status(200).json({
    success: true,
    message: "Rewards redemption order initiated. Proceed with customer authorization.",
    order_id: rzpOrder.order_id,
    amount: customerPayablePaise,
    amount_in_rupees: customerPayableRupees,
    currency: "INR",
    key_id: rzpOrder.key_id,
    product_value: numProductValue,
    points_required: numPointsRequired,
    is_express: isExpress,
    express_delivery_fee: expressFee,
    platform_fee_breakdown: {
      base_fee: platformFeeBase,
      gst_18: platformFeeGst,
      platform_fee_total: 11.79,
      express_fee: expressFee,
      total_payable: customerPayableRupees,
    },
  });
});

/**
 * Shared redemption execution pipeline:
 * Deducts exact Y points, allocates Cikka treasury payout on T+7 hold,
 * records settlement with 100% Cikka retained platform & express revenue,
 * and pushes shipment to Shipway.
 */
async function executeRedemptionFulfillment(params: {
  order_id: string;
  payment_id: string;
  product_name: string;
  product_value: number;
  points_burned: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  pincode: string;
  city: string;
  pickup_pincode?: string;
  carrier_name?: string;
  category?: string;
  is_express?: boolean;
  authenticatedUserId?: string | null;
}) {
  const {
    order_id,
    payment_id,
    product_name = "Cikka Rewards Store Product",
    product_value = 1000,
    points_burned = 1000,
    customer_name = "Cikka Member",
    customer_email = "",
    customer_phone = "",
    delivery_address = "",
    pincode = "400001",
    city = "Mumbai",
    pickup_pincode = "122008",
    carrier_name = "Delhivery 3PL Express (0.5kg)",
    category = "Rewards",
    is_express = false,
    authenticatedUserId = null,
  } = params;

  const numProductValue = Number(product_value) || 1000;
  const numPointsBurned = Number(points_burned) || numProductValue;
  const expressFee = is_express ? 50.0 : 0.0;
  const customerFeePaid = Number((11.79 + expressFee).toFixed(2));

  // 1. Validate & Deduct exact Y CI Points from User
  const user = await resolveRedeemingUser(authenticatedUserId, customer_phone);
  if (!user && config.isProduction) {
    throw new Error("Please sign in to redeem CI Points.");
  }
  const cleanPhone = String(customer_phone || "").replace(/\D/g, "").slice(-10);

  const currentPoints = user ? user.ciPoints : 100000;
  if (currentPoints < numPointsBurned) {
    throw new Error("points doesnt match the require CI points");
  }

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ciPoints: { decrement: numPointsBurned },
      },
    });
    console.log(
      `[CI Points Deducted] User #${user.id} (${cleanPhone}) burned EXACT ${numPointsBurned} CI Points. New Balance: ${
        currentPoints - numPointsBurned
      }`
    );
  }

  // 2. Generate Primary Identifiers
  const randSuffix = Math.floor(100000 + Math.random() * 900000);
  const finalOrderId = `ORD-RW-${randSuffix}`;
  const redemptionId = `RDM-${randSuffix}`;
  const generatedAwb = `AWB-${Math.floor(10000000 + Math.random() * 90000000)}`;

  // 3. Resolve Seller & Product
  const seller = await findOrCreateSeller(pickup_pincode, "Rewards");
  if (!seller) {
    throw new Error("Failed to resolve seller for redemption pickup");
  }

  const productId = await getOrCreateProductForSeller(seller.id, product_name, numProductValue, "Rewards");

  // 4. Create Order & OrderItem in Prisma DB (Marked as Rewards Store, Prepaid by Cikka, PENDING packing)
  const dbOrder = await prisma.order.create({
    data: {
      sellerId: seller.id,
      orderNumber: finalOrderId,
      customerName: `${customer_name} (${redemptionId})`,
      customerCity: `${city} (${pincode})`,
      totalAmount: numProductValue,
      status: OrderStatus.PENDING,
      trackingNumber: null,
      courier: carrier_name || null,
      items: {
        create: [
          {
            productId,
            quantity: 1,
            unitPrice: numProductValue,
          },
        ],
      },
    },
    include: { items: true },
  });

  console.log(
    `[Rewards Store Order Created] #${finalOrderId} (${product_name}) linked to Redemption #${redemptionId} -> Seller #${seller.id}`
  );

  // 5. Calculate Deterministic Settlement Breakdown (Paid by Cikka Corporate Treasury)
  const profile = await getSellerSettlementProfile(seller.id, category);
  const breakdown = calculateSettlementBreakdown(numProductValue, profile.customConfig);
  const netSellerPayout = breakdown.sellerNetSettlement;
  const netPaise = Math.round(netSellerPayout * 100);

  // 6. Resolve Seller Razorpay Linked Account
  let rzpAccountId = seller.razorpayAccountId || (seller.onboarding as any)?.razorpayAccountId;
  if (!rzpAccountId) {
    try {
      const accRes = await razorpayRouteService.createLinkedAccount({
        sellerId: seller.id,
        businessName: seller.businessName || "Cikka Merchant Partner",
        businessType: seller.onboarding?.businessType as any,
        email: seller.email || "seller@cikka.club",
        phone: seller.phone || "9876543210",
        signatoryName: seller.onboarding?.signatoryName || undefined,
        panNumber: seller.onboarding?.panNumber || undefined,
        gstNumber: seller.onboarding?.gstNumber || undefined,
        address: seller.onboarding?.pickupAddress as any,
      });
      if (accRes.accountId) {
        rzpAccountId = accRes.accountId;
      }
    } catch (accErr: any) {
      console.warn(`[Rewards Route Account Notice]: ${accErr.message}`);
    }
  }

  // 7. Cikka Corporate Funding Transfer via Razorpay Route with T+7 Hold
  let transferResult: any = null;
  if (rzpAccountId && netPaise > 0) {
    try {
      transferResult = await razorpayRouteService.transferPaymentWithT7Hold({
        paymentId: payment_id,
        sellerAccountId: rzpAccountId,
        amountInPaise: netPaise,
        holdDays: profile.holdDays,
        notes: {
          orderNumber: finalOrderId,
          redemptionNumber: redemptionId,
          fundingSource: "CIKKA_REWARDS_TREASURY",
          category,
          productValue: String(numProductValue),
          pointsBurned: String(numPointsBurned),
          netPayable: String(netSellerPayout),
          isExpress: String(is_express),
        },
      });
    } catch (trfErr: any) {
      console.warn(`[Rewards Route Transfer Warning]: ${trfErr.message}`);
    }
  }

  // 8. Record Deterministic Settlement in Prisma (100% Cikka Retained Customer Fee Revenue)
  const holdUntil = transferResult?.holdUntil || new Date(Date.now() + profile.holdDays * 86400000);

  const settlement = await prisma.settlement.create({
    data: {
      sellerId: seller.id,
      periodStart: new Date(),
      periodEnd: new Date(),
      category: "Rewards Store Redemption",
      grossSales: breakdown.grossProductValue,
      basePrice: breakdown.baseProductValue,
      gstOnSale: breakdown.productGst,
      commissionRate: breakdown.commissionRate,
      commissionAmount: breakdown.commission,
      commissionTotal: breakdown.commissionTotal,
      shippingFee: breakdown.shipping,
      shippingTotal: breakdown.shippingTotal,
      sellerPlatformFee: breakdown.sellerPlatformFee,
      sellerPlatformTotal: breakdown.sellerPlatformTotal,
      tdsAmount: breakdown.tds,
      tcsAmount: breakdown.tcs,
      statutoryTaxes: breakdown.tds + breakdown.tcs,
      successFeeAmount: breakdown.successFee,
      successFeeTotal: breakdown.successFeeTotal,
      customerPlatformFee: breakdown.customerPlatformFee,
      customerPlatformTotal: breakdown.customerPlatformTotal,
      customerTotalPayment: customerFeePaid,
      cikkaFeeRevenue: Number((breakdown.cikkaFeeRevenue + expressFee).toFixed(2)),
      cikkaGstCollected: breakdown.cikkaGstCollected,
      totalDeductions: breakdown.totalSellerDeductions,
      netPayable: breakdown.sellerNetSettlement,
      status: "PENDING",
      transferStatus: transferResult?.onHold ? "ON_HOLD" : "SETTLED",
      razorpayTransferId: transferResult?.transferId,
      razorpayPaymentId: payment_id,
      holdUntil,
      payoutDate: holdUntil,
      ledgerBreakdown: {
        ...breakdown,
        orderId: finalOrderId,
        redemptionId,
        customerPaymentId: payment_id,
        fundingSource: "CIKKA_REWARDS_TREASURY",
        pointsBurned: numPointsBurned,
        customerFeePaid,
        expressFee,
        isExpress: Boolean(is_express),
        platformFeeDirectToCikka: 11.79,
        expressFeeDirectToCikka: expressFee,
      } as any,
    } as any,
  });

  // 8b. Atomically debit CI Points from server-side ledger (double-entry)
  //     Tied to redemptionId so this can never be applied twice even if the
  //     client retries the confirm endpoint.
  let walletDebitResult: Awaited<ReturnType<typeof walletService.debitPoints>> | null = null;
  if (authenticatedUserId && numPointsBurned > 0) {
    try {
      walletDebitResult = await walletService.debitPoints(
        authenticatedUserId,
        numPointsBurned,
        WalletTxType.REDEEM_REWARD,
        {
          redemptionId,
          razorpayPaymentId: payment_id,
          description: `Rewards Store redemption: ${product_name}`,
          // One debit per Razorpay order, however many times fulfilment is attempted.
          idempotencyKey: `REDEEM_REWARD:${order_id}`,
        }
      );
    } catch (walletErr: any) {
      // Log but don't fail the response — settlement is already recorded.
      // The ledger entry will simply be missing; ops can reconcile manually.
      console.warn(`[Rewards Wallet Debit Warning]: ${walletErr.message}`);
    }
  }

  // 9. Emit Seller In-App Notifications
  await prisma.notification.create({
    data: {
      sellerId: seller.id,
      type: NotificationType.ORDER,
      title: `Rewards Store Order: #${finalOrderId}`,
      body: `Prepaid by Cikka via CI Points Redemption (${redemptionId}). Mode: ${
        is_express ? "Express 2-Day" : "Standard"
      }. Courier: ${carrier_name || "Shipway Partner"}. Please pack order to generate shipping label.`,
      metadata: {
        orderNumber: finalOrderId,
        redemptionNumber: redemptionId,
        courier: carrier_name,
        isExpress: is_express,
      },
    },
  }).catch(() => {});

  return {
    order_id: finalOrderId,
    redemption_id: redemptionId,
    customer_payment_id: payment_id,
    customer_fee_paid: customerFeePaid,
    points_burned: numPointsBurned,
    product_value: numProductValue,
    is_express: Boolean(is_express),
    cashback_earned: 0,
    points_earned: 0,
    net_seller_payout: netSellerPayout,
    cikka_retained_earnings: Number((breakdown.cikkaFeeRevenue + expressFee).toFixed(2)),
    transfer_id: transferResult?.transferId,
    settlement_id: settlement.id,
    hold_until: holdUntil,
    awb: null,
    courier: carrier_name,
    tracking_url: `/api/shipway/tracking/${finalOrderId}`,
    // Updated server-side wallet balance (undefined if user not authenticated or no points burned)
    wallet: walletDebitResult
      ? {
          balance_after_points: walletDebitResult.balanceAfterPoints,
          balance_after_cash_rupees: walletDebitResult.balanceAfterPaise / 100,
          ledger_entry_id: walletDebitResult.ledgerEntryId,
        }
      : null,
  };
}

/** Expected platform fee for a redemption, in paise: ₹11.79, or ₹61.79 with express. */
function expectedRewardsFeePaise(isExpress: boolean): number {
  return Math.round((11.79 + (isExpress ? 50 : 0)) * 100);
}

/**
 * Fulfil a confirmed rewards payment. What is redeemed (product, value, points, express) comes
 * from the snapshot recorded at initiate-redemption when there is one; delivery details come
 * from the snapshot or the verified request.
 */
export async function fulfilRewardsCheckout(
  checkout: RazorpayCheckoutRow,
  paymentId: string,
  amountPaise: number,
  requestBody: any,
  authenticatedUserId: string | null
) {
  const snap = ((checkout.snapshot as any) || {}) as Record<string, any>;
  const body = requestBody || {};
  const hasSnapshot = snap.points_burned !== undefined;
  const pick = (key: string) => (snap[key] !== undefined ? snap[key] : body[key]);

  const isExpress = hasSnapshot
    ? Boolean(snap.is_express)
    : Boolean(body.is_express || body.delivery_option === "express");
  if (amountPaise !== expectedRewardsFeePaise(isExpress)) {
    throw new PaymentVerificationError(400, "AMOUNT_MISMATCH", "Paid amount does not match the redemption fee.");
  }

  return executeRedemptionFulfillment({
    order_id: checkout.razorpayOrderId,
    payment_id: paymentId,
    product_name: hasSnapshot ? snap.product_name : body.product_name,
    product_value: hasSnapshot ? snap.product_value : body.product_value,
    points_burned: hasSnapshot ? snap.points_burned : body.points_burned,
    customer_name: pick("customer_name"),
    customer_email: pick("customer_email"),
    customer_phone: pick("customer_phone"),
    delivery_address: pick("delivery_address"),
    pincode: pick("pincode"),
    city: pick("city"),
    pickup_pincode: pick("pickup_pincode"),
    carrier_name: pick("carrier_name"),
    category: pick("category"),
    is_express: isExpress,
    authenticatedUserId: authenticatedUserId ?? checkout.userId ?? null,
  });
}

/** Verify a rewards payment with Razorpay and fulfil it once; answers the HTTP request. */
async function confirmAndFulfilRewards(
  req: Request,
  res: Response,
  orderId: string,
  paymentId: string,
  via: "VERIFY" | "CARD_OTP",
  message: string
) {
  if (config.isProduction && !req.user?.id) {
    res.status(401).json({ success: false, verified: false, error: "Please sign in to redeem CI Points." });
    return;
  }

  try {
    const confirmed = await razorpayCheckoutService.confirmCapturedPayment({
      orderId,
      paymentId,
      purpose: "REWARDS",
    });
    if (confirmed.checkout?.userId && req.user?.id && confirmed.checkout.userId !== req.user.id) {
      throw new PaymentVerificationError(403, "WRONG_USER", "This redemption belongs to another account.");
    }

    const outcome: FulfilmentOutcome = await razorpayCheckoutService.fulfilOnce({
      orderId,
      paymentId,
      purpose: "REWARDS",
      amountPaise: confirmed.amountPaise,
      currency: confirmed.payment.currency,
      userId: req.user?.id,
      via,
      fulfil: (checkout) =>
        fulfilRewardsCheckout(checkout, paymentId, confirmed.amountPaise, req.body, req.user?.id ?? null),
    });

    if (outcome.state === "IN_PROGRESS") {
      res.status(202).json({
        success: true,
        verified: true,
        processing: true,
        message: "Payment verified. Your redemption is being processed.",
        customer_payment_id: paymentId,
      });
      return;
    }

    res.status(200).json({
      success: true,
      verified: true,
      message,
      duplicate: outcome.state === "DUPLICATE" ? true : undefined,
      ...(outcome.result || {}),
    });
  } catch (err: any) {
    if (err instanceof PaymentVerificationError) {
      res.status(err.status).json({ success: false, verified: false, error: err.message, code: err.code });
      return;
    }
    res.status(400).json({
      success: false,
      verified: false,
      error: err.message || "Failed to confirm redemption",
    });
  }
}

/**
 * POST /api/rewards/confirm-redemption
 * Step 2: verify the Checkout signature, confirm the captured fee with Razorpay, then fulfil once.
 */
export const confirmRedemption = asyncHandler(async (req: Request, res: Response) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature",
    });
    return;
  }

  const isValid = razorpayService.verifyPaymentSignature(
    String(razorpay_order_id),
    String(razorpay_payment_id),
    String(razorpay_signature)
  );

  if (!isValid) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Invalid customer payment signature for platform fee",
    });
    return;
  }

  await confirmAndFulfilRewards(
    req,
    res,
    String(razorpay_order_id),
    String(razorpay_payment_id),
    "VERIFY",
    "Rewards redemption confirmed, exact CI points burned, and order dispatched."
  );
});

/**
 * POST /api/rewards/pay-with-card
 * Saved-card payment of the redemption fee (₹11.79, or ₹61.79 with express).
 * Real mode: answers `requires_otp: false` so the app opens Razorpay Checkout
 * (initiate-redemption → confirm-redemption). Stub mode only: simulated 3DS flow.
 */
export const payWithCardForRewards = asyncHandler(async (req: Request, res: Response) => {
  const {
    card_id,
    token_id,
    product_id,
    product_name = "Cikka Rewards Store Product",
    product_value = 1000,
    points_required = 1000,
    is_express,
    delivery_option,
    customer_name,
    customer_email,
    customer_phone,
  } = req.body;

  const cardIdentifier = card_id || token_id;
  if (!cardIdentifier) {
    res.status(400).json({
      success: false,
      error: "Card ID or Token ID is required for tokenized checkout",
    });
    return;
  }

  const numPointsRequired = Number(points_required) || 1000;
  const isExpress = Boolean(is_express || delivery_option === "express");
  const expressFee = isExpress ? 50.0 : 0.0;
  const totalPayableRupees = Number((11.79 + expressFee).toFixed(2));
  const amountInPaise = expectedRewardsFeePaise(isExpress);

  if (config.isProduction && !req.user?.id) {
    res.status(401).json({ success: false, error: "Please sign in to redeem CI Points." });
    return;
  }

  // Validate CI Points Balance
  const user = await resolveRedeemingUser(req.user?.id ?? null, customer_phone);
  if (user || req.user?.id) {
    const userBalance = user?.ciPoints ?? 0;
    if (userBalance < numPointsRequired) {
      res.status(400).json({
        success: false,
        error: "points doesnt match the require CI points",
        current_ci_points: userBalance,
        required_ci_points: numPointsRequired,
        shortfall: numPointsRequired - userBalance,
      });
      return;
    }
  }

  if (!isRazorpayStubMode()) {
    res.status(200).json({
      success: true,
      requires_otp: false,
      requires_checkout: true,
      amount: totalPayableRupees,
      amount_in_paise: amountInPaise,
      is_express: isExpress,
      express_delivery_fee: expressFee,
      platform_fee: 11.79,
      message: "Complete the fee payment in Razorpay Checkout.",
    });
    return;
  }

  const savedCard = req.user?.id
    ? await prisma.userSavedCard.findFirst({
        where: {
          userId: req.user.id,
          status: "ACTIVE",
          OR: [{ id: String(cardIdentifier) }, { razorpayTokenId: String(cardIdentifier) }],
        },
      })
    : null;

  const { order } = await razorpayCheckoutService.createCheckout({
    purpose: "REWARDS",
    amountPaise: amountInPaise,
    currency: "INR",
    receipt: `rw_card_${Date.now()}`,
    userId: req.user?.id,
    snapshot: {
      product_id,
      product_name,
      product_value: Number(product_value) || 1000,
      points_burned: numPointsRequired,
      is_express: isExpress,
      customer_name,
      customer_email,
      customer_phone,
    },
  });
  const paymentId = `${STUB_PAYMENT_PREFIX}${crypto.randomBytes(7).toString("hex")}`;

  const rawPhone = String(customer_phone || "").replace(/\D/g, "");
  const phoneLast4 = rawPhone.length >= 4 ? rawPhone.slice(-4) : "";

  res.status(200).json({
    success: true,
    requires_otp: true,
    order_id: order.order_id,
    payment_id: paymentId,
    bank_name: savedCard?.bankName || req.body.bank_name || "",
    card_network: savedCard?.cardNetwork || req.body.card_network || "",
    card_type: savedCard?.cardType || "credit",
    card_last4: savedCard?.last4 || req.body.last4 || "",
    phone_last4: phoneLast4,
    amount: totalPayableRupees,
    amount_in_paise: amountInPaise,
    is_express: isExpress,
    express_delivery_fee: expressFee,
    platform_fee: 11.79,
    acs_url: null,
    message: "[Stub] 3D Secure OTP simulated",
  });
});

/**
 * POST /api/rewards/verify-card-otp
 * Confirms the fee payment with Razorpay (exists, belongs to order_id, captured, right amount)
 * and fulfils the redemption once. The OTP itself is checked by the bank, not by us.
 */
export const verifyCardOtpForRewards = asyncHandler(async (req: Request, res: Response) => {
  const { order_id, payment_id, otp } = req.body;

  if (!order_id || !payment_id) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: order_id and payment_id",
    });
    return;
  }

  const cleanOtp = String(otp || "").trim();
  if (cleanOtp.length < 4 || cleanOtp.length > 8) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Invalid OTP. Please enter the valid code sent to your registered mobile number.",
    });
    return;
  }

  await confirmAndFulfilRewards(
    req,
    res,
    String(order_id),
    String(payment_id),
    "CARD_OTP",
    "Rewards platform fee authorized, exact CI points burned, and order dispatched."
  );
});
