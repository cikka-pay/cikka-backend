import crypto from "crypto";
import { Request, Response } from "express";
import { razorpayService, STUB_PAYMENT_PREFIX } from "../services/razorpay.service";
import {
  razorpayCheckoutService,
  PaymentVerificationError,
  FulfilmentOutcome,
} from "../services/razorpayCheckout.service";
import { isRazorpayStubMode } from "../config/env";
import { walletService } from "../services/wallet.service";
import { PricingError, paiseToRupees, CUSTOMER_PLATFORM_FEE_PAISE, CUSTOMER_PLATFORM_FEE_GST_PAISE, CUSTOMER_PLATFORM_FEE_TOTAL_PAISE } from "../services/mallPricing.service";
import { fulfilRewardsCheckout, pickShipping, priceReward, RewardSnapshot } from "../services/checkoutFulfilment.service";
import { savedCardsService } from "../services/razorpayToken.service";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

/**
 * GET /api/rewards/balance, GET /api/rewards/user/balance  (user JWT required)
 * The signed-in user's CI Points and cashback from the ledger wallet (the source of truth).
 * The old `?phone=` lookup is ignored.
 */
export const getUserRewardBalance = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [user, balance] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { phone: true } }),
    walletService.getBalance(userId),
  ]);
  res.status(200).json({
    success: true,
    phone: user?.phone ?? null,
    ci_points: balance.ciPoints,
    cashback_balance: balance.cashRupees,
    source: "ledger",
  });
});

function sendPricingError(res: Response, err: unknown): boolean {
  if (err instanceof PricingError) {
    res.status(err.status).json({ success: false, error: err.message, code: err.code, ...(err.details || {}) });
    return true;
  }
  return false;
}

/**
 * Price the redemption on the server and check the buyer's ledger balance. Answers the
 * request and returns null on any problem.
 */
async function priceRedemption(req: Request, res: Response): Promise<RewardSnapshot | null> {
  if (!req.user?.id) {
    res.status(401).json({ success: false, code: "AUTH_REQUIRED", error: "Please sign in to redeem CI Points." });
    return null;
  }
  const body = req.body || {};
  const productId = body.productId ?? body.product_id;
  if (!productId) {
    res.status(400).json({ success: false, code: "UNKNOWN_PRODUCT", error: "productId is required to redeem a reward." });
    return null;
  }
  const isExpress = Boolean(body.is_express === true || body.is_express === "true" || body.delivery_option === "express");

  let reward: RewardSnapshot;
  try {
    reward = await priceReward(String(productId), body.variantId ?? body.variant_id ?? null, isExpress);
  } catch (err) {
    if (sendPricingError(res, err)) return null;
    throw err;
  }

  const clientPoints = body.pointsRequired ?? body.points_required;
  if (clientPoints !== undefined && clientPoints !== null && Number(clientPoints) !== reward.points) {
    res.status(409).json({
      success: false,
      code: "PRICE_CHANGED",
      error: `This reward now needs ${reward.points} CI Points.`,
      required_ci_points: reward.points,
      product_value: paiseToRupees(reward.product_value_paise),
    });
    return null;
  }

  const balance = await walletService.getBalance(req.user.id);
  if (balance.ciPoints < reward.points) {
    res.status(400).json({
      success: false,
      code: "INSUFFICIENT_POINTS",
      error: "points doesnt match the require CI points",
      current_ci_points: balance.ciPoints,
      required_ci_points: reward.points,
      shortfall: reward.points - balance.ciPoints,
    });
    return null;
  }
  return reward;
}

function feeBreakdown(reward: RewardSnapshot) {
  const express = reward.fee_paise - CUSTOMER_PLATFORM_FEE_TOTAL_PAISE;
  return {
    base_fee: paiseToRupees(CUSTOMER_PLATFORM_FEE_PAISE),
    gst_18: paiseToRupees(CUSTOMER_PLATFORM_FEE_GST_PAISE),
    platform_fee_total: paiseToRupees(CUSTOMER_PLATFORM_FEE_TOTAL_PAISE),
    express_fee: paiseToRupees(express),
    total_payable: paiseToRupees(reward.fee_paise),
  };
}

function rewardSnapshot(reward: RewardSnapshot, body: any) {
  return { reward, ...pickShipping(body), ...pickShipping({
    customer_name: body?.customerName,
    customer_email: body?.customerEmail,
    customer_phone: body?.customerPhone,
  }) };
}

/**
 * POST /api/rewards/initiate-redemption
 * Step 1: price the reward on the server (ACTIVE product, points = round(price)), check the
 * ledger balance and create the Razorpay order for the fee: ₹11.79, or ₹61.79 with express.
 */
export const initiateRedemption = asyncHandler(async (req: Request, res: Response) => {
  const reward = await priceRedemption(req, res);
  if (!reward) return;

  const { order: rzpOrder } = await razorpayCheckoutService.createCheckout({
    purpose: "REWARDS",
    amountPaise: reward.fee_paise,
    currency: "INR",
    receipt: `rw_rcpt_${Date.now()}`,
    userId: req.user!.id,
    notes: {
      type: reward.is_express ? "REWARDS_STORE_PLATFORM_AND_EXPRESS_FEE" : "REWARDS_STORE_PLATFORM_FEE",
      product_id: reward.product_id,
      points_required: String(reward.points),
      is_express: String(reward.is_express),
    },
    // What is redeemed is fixed here, before payment; confirm uses this, never the body.
    snapshot: rewardSnapshot(reward, req.body),
  });
  const customerId = await savedCardsService.customerIdFor(req.user!.id);

  res.status(200).json({
    success: true,
    message: "Rewards redemption order initiated. Proceed with customer authorization.",
    order_id: rzpOrder.order_id,
    amount: reward.fee_paise,
    amount_in_rupees: paiseToRupees(reward.fee_paise),
    currency: "INR",
    key_id: rzpOrder.key_id,
    customer_id: customerId,
    product_id: reward.product_id,
    product_name: reward.product_name,
    product_value: paiseToRupees(reward.product_value_paise),
    points_required: reward.points,
    is_express: reward.is_express,
    express_delivery_fee: feeBreakdown(reward).express_fee,
    platform_fee_breakdown: feeBreakdown(reward),
  });
});

/** Verify a rewards payment with Razorpay and fulfil it once; answers the HTTP request. */
async function confirmAndFulfilRewards(
  req: Request,
  res: Response,
  orderId: string,
  paymentId: string,
  via: "VERIFY" | "CARD_OTP",
  message: string
) {
  if (!req.user?.id) {
    res.status(401).json({ success: false, verified: false, error: "Please sign in to redeem CI Points." });
    return;
  }

  try {
    const confirmed = await razorpayCheckoutService.confirmCapturedPayment({ orderId, paymentId, purpose: "REWARDS" });
    if (confirmed.checkout?.userId && confirmed.checkout.userId !== req.user.id) {
      throw new PaymentVerificationError(403, "WRONG_USER", "This redemption belongs to another account.");
    }

    const outcome: FulfilmentOutcome = await razorpayCheckoutService.fulfilOnce({
      orderId,
      paymentId,
      purpose: "REWARDS",
      amountPaise: confirmed.amountPaise,
      currency: confirmed.payment.currency,
      userId: req.user.id,
      via,
      fulfil: (checkout) => fulfilRewardsCheckout(checkout, paymentId, confirmed.amountPaise, req.body),
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
    if (outcome.state === "REJECTED") {
      res.status(409).json({
        success: false,
        verified: true,
        ...(outcome.result || {}),
        error: `${outcome.result?.error || "Redemption could not be completed."} Your fee has been refunded.`,
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
    throw err;
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
    res.status(400).json({ success: false, verified: false, error: "Invalid customer payment signature for platform fee" });
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
 * Saved-card payment of the redemption fee. Same server pricing and balance check as
 * initiate-redemption. Real mode answers `requires_checkout: true` (the app opens Razorpay
 * Checkout via initiate-redemption → confirm-redemption). Stub mode only: simulated 3DS flow.
 */
export const payWithCardForRewards = asyncHandler(async (req: Request, res: Response) => {
  const cardIdentifier = req.body?.card_id || req.body?.token_id;
  if (!cardIdentifier) {
    res.status(400).json({ success: false, error: "Card ID or Token ID is required for tokenized checkout" });
    return;
  }

  const reward = await priceRedemption(req, res);
  if (!reward) return;
  const savedCard = await savedCardsService.findUserCard(req.user!.id, String(cardIdentifier));
  if (!savedCard) {
    res.status(404).json({ success: false, code: "CARD_NOT_FOUND", error: "That saved card was not found on your account." });
    return;
  }
  const fees = feeBreakdown(reward);

  if (!isRazorpayStubMode()) {
    res.status(200).json({
      success: true,
      requires_otp: false,
      requires_checkout: true,
      amount: fees.total_payable,
      amount_in_paise: reward.fee_paise,
      is_express: reward.is_express,
      express_delivery_fee: fees.express_fee,
      platform_fee: fees.platform_fee_total,
      points_required: reward.points,
      token_id: savedCard.razorpayTokenId,
      message: "Complete the fee payment in Razorpay Checkout.",
    });
    return;
  }

  const { order } = await razorpayCheckoutService.createCheckout({
    purpose: "REWARDS",
    amountPaise: reward.fee_paise,
    currency: "INR",
    receipt: `rw_card_${Date.now()}`,
    userId: req.user!.id,
    snapshot: rewardSnapshot(reward, req.body),
  });
  const paymentId = `${STUB_PAYMENT_PREFIX}${crypto.randomBytes(7).toString("hex")}`;
  const rawPhone = String(req.body?.customer_phone || "").replace(/\D/g, "");

  res.status(200).json({
    success: true,
    requires_otp: true,
    order_id: order.order_id,
    payment_id: paymentId,
    bank_name: savedCard.bankName,
    card_network: savedCard.cardNetwork,
    card_type: savedCard.cardType,
    card_last4: savedCard.last4,
    phone_last4: rawPhone.length >= 4 ? rawPhone.slice(-4) : "",
    amount: fees.total_payable,
    amount_in_paise: reward.fee_paise,
    is_express: reward.is_express,
    express_delivery_fee: fees.express_fee,
    platform_fee: fees.platform_fee_total,
    points_required: reward.points,
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
    res.status(400).json({ success: false, error: "Missing required fields: order_id and payment_id" });
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
