import crypto from "crypto";
import { Request, Response } from "express";
import { razorpayService, STUB_PAYMENT_PREFIX } from "../services/razorpay.service";
import {
  razorpayCheckoutService,
  PaymentVerificationError,
  RazorpayCheckoutRow,
  FulfilmentOutcome,
} from "../services/razorpayCheckout.service";
import {
  PricedCart,
  PricingError,
  checkExchangeOrder,
  parsePricingRequest,
  priceCart,
  toPricingSnapshot,
  toQuoteResponse,
  verifyQuote,
} from "../services/mallPricing.service";
import { fulfilMallCheckout, pickShipping } from "../services/checkoutFulfilment.service";
import { savedCardsService } from "../services/razorpayToken.service";
import { asyncHandler } from "../utils/asyncHandler";
import { config, isRazorpayStubMode } from "../config/env";

/** Razorpay notes: at most 15 string key/value pairs. */
function sanitizeNotes(notes: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return out;
  for (const [k, v] of Object.entries(notes as Record<string, unknown>).slice(0, 10)) {
    if (v === undefined || v === null || typeof v === "object") continue;
    out[String(k).slice(0, 255)] = String(v).slice(0, 255);
  }
  return out;
}

function sendVerificationError(res: Response, err: unknown): boolean {
  if (err instanceof PaymentVerificationError) {
    res.status(err.status).json({ success: false, verified: false, error: err.message, code: err.code });
    return true;
  }
  return false;
}

export function sendPricingError(res: Response, err: unknown): boolean {
  if (err instanceof PricingError) {
    res.status(err.status).json({ success: false, error: err.message, code: err.code, ...(err.details || {}) });
    return true;
  }
  return false;
}

/**
 * Price the request body on the server and check it against what the client believes it is
 * paying. Returns the cart, or null after answering the request (4xx).
 *  - `quote_id` (optional): must verify against the recomputed cart.
 *  - client amount (optional; `amountUnit` says whether `amount` is paise or rupees): must
 *    equal the server total — otherwise 409 PRICE_CHANGED with a fresh quote.
 */
async function priceCheckoutRequest(req: Request, res: Response, amountUnit: "paise" | "rupees"): Promise<PricedCart | null> {
  const userId = req.user?.id ?? null;
  let cart: PricedCart;
  try {
    cart = await priceCart(parsePricingRequest(req.body), userId);
  } catch (err) {
    if (sendPricingError(res, err)) return null;
    throw err;
  }

  const priceChanged = (reason: string) =>
    res.status(409).json({
      success: false,
      code: "PRICE_CHANGED",
      error: `${reason} Please review the updated total.`,
      quote: toQuoteResponse(cart, userId),
    });

  const quoteId = req.body?.quote_id ?? req.body?.quoteId;
  if (quoteId) {
    const problem = verifyQuote(String(quoteId), cart, userId);
    if (problem) {
      priceChanged(problem);
      return null;
    }
  }

  const { amount, amount_in_paise } = req.body || {};
  let clientPaise: number | null = null;
  if (amount_in_paise !== undefined && amount_in_paise !== null && amount_in_paise !== "") {
    clientPaise = Math.round(Number(amount_in_paise));
  } else if (amount !== undefined && amount !== null && amount !== "") {
    clientPaise = Math.round(Number(amount) * (amountUnit === "rupees" ? 100 : 1));
  }
  if (clientPaise !== null && clientPaise !== cart.totalPaise) {
    priceChanged(`The total is ₹${(cart.totalPaise / 100).toFixed(2)}, not ₹${(clientPaise / 100).toFixed(2)}.`);
    return null;
  }

  if (cart.totalPaise === 0) {
    res.status(400).json({
      success: false,
      code: "NO_PAYMENT_REQUIRED",
      error: "Nothing to pay for this order. Exchanges with no difference go through /api/returns/exchange.",
      quote: toQuoteResponse(cart, userId),
    });
    return null;
  }
  if (cart.totalPaise < 100) {
    res.status(400).json({ success: false, code: "AMOUNT_TOO_SMALL", error: "The minimum payable amount is ₹1.00." });
    return null;
  }
  return cart;
}

function requireBuyerInProduction(req: Request, res: Response): boolean {
  if (config.isProduction && !req.user?.id) {
    res.status(401).json({ success: false, code: "AUTH_REQUIRED", error: "Please sign in to place an order." });
    return false;
  }
  return true;
}

function checkoutSnapshot(cart: PricedCart, body: any) {
  return { pricing: toPricingSnapshot(cart), shipping: pickShipping(body) };
}

/**
 * POST /api/payment/create-order
 * Price the cart on the server (same function as POST /api/mall/quote), create the Razorpay
 * order for that total and record the priced snapshot for fulfilment (verify or webhook).
 * Client item prices are ignored; a client `amount` (paise) must equal the server total.
 */
export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  if (!requireBuyerInProduction(req, res)) return;
  const cart = await priceCheckoutRequest(req, res, "paise");
  if (!cart) return;

  const userId = req.user?.id ?? null;
  const customerId = userId ? await savedCardsService.customerIdFor(userId) : null;
  const { order } = await razorpayCheckoutService.createCheckout({
    purpose: "MALL",
    amountPaise: cart.totalPaise,
    currency: "INR",
    receipt: req.body?.receipt,
    notes: {
      ...sanitizeNotes(req.body?.notes),
      lines: String(cart.lines.length),
      ...(cart.exchange ? { exchange_order: cart.exchange.orderNumber } : {}),
    },
    userId,
    snapshot: checkoutSnapshot(cart, req.body),
  });

  res.status(200).json({
    success: true,
    message: "Razorpay order created successfully",
    ...order,
    amount_in_paise: order.amount,
    customer_id: customerId,
    quote: toQuoteResponse(cart, userId),
  });
});

/** Before capturing an authorized exchange payment, the exchange must still be allowed. */
export async function mallBeforeCapture(checkout: RazorpayCheckoutRow | null) {
  const exchange = (checkout?.snapshot as any)?.pricing?.exchange;
  if (!exchange) return;
  const check = await checkExchangeOrder(checkout!.userId, { orderId: exchange.orderId });
  if (check.reasons.length > 0) {
    throw new PaymentVerificationError(409, "EXCHANGE_NOT_ELIGIBLE", check.reasons[0].message);
  }
}

/** Shape the verify/card-OTP response from a fulfilment outcome. */
function sendMallOutcome(res: Response, outcome: FulfilmentOutcome, orderId: string, paymentId: string, message: string) {
  if (outcome.state === "IN_PROGRESS") {
    res.status(202).json({
      success: true,
      verified: true,
      processing: true,
      message: "Payment verified. Your order is being placed.",
      payment_id: paymentId,
      order_id: orderId,
      processed_orders: [],
    });
    return;
  }
  if (outcome.state === "REJECTED") {
    res.status(409).json({
      success: false,
      verified: true,
      ...(outcome.result || {}),
      error: `${outcome.result?.error || "Your order could not be placed."} Your payment has been refunded.`,
      payment_id: paymentId,
      order_id: orderId,
    });
    return;
  }
  res.status(200).json({
    success: true,
    verified: true,
    message,
    duplicate: outcome.state === "DUPLICATE" ? true : undefined,
    ...(outcome.result || {}),
    payment_id: paymentId,
    order_id: orderId,
  });
}

/** Confirm a mall payment with Razorpay and fulfil it once; answers the HTTP request. */
async function confirmAndFulfilMall(
  req: Request,
  res: Response,
  orderId: string,
  paymentId: string,
  via: "VERIFY" | "CARD_OTP",
  message: string
) {
  try {
    const confirmed = await razorpayCheckoutService.confirmCapturedPayment({
      orderId,
      paymentId,
      purpose: "MALL",
      beforeCapture: mallBeforeCapture,
    });
    if (confirmed.checkout?.userId && req.user?.id && confirmed.checkout.userId !== req.user.id) {
      throw new PaymentVerificationError(403, "WRONG_USER", "This payment belongs to another account.");
    }

    const outcome = await razorpayCheckoutService.fulfilOnce({
      orderId,
      paymentId,
      purpose: "MALL",
      amountPaise: confirmed.amountPaise,
      currency: confirmed.payment.currency,
      userId: req.user?.id,
      via,
      fulfil: (checkout) => fulfilMallCheckout(checkout, paymentId, confirmed.amountPaise),
    });
    sendMallOutcome(res, outcome, orderId, paymentId, message);
  } catch (err) {
    if (sendVerificationError(res, err)) return;
    throw err;
  }
}

/**
 * POST /api/payment/verify-payment
 * 1. HMAC-SHA256(order_id|payment_id, key_secret) signature check.
 * 2. Fetch the payment from Razorpay: must belong to the order, be captured (captured here if
 *    only authorized) and match the order amount. Client-sent amount and cart are ignored.
 * 3. Fulfil at most once per Razorpay order from the server-priced snapshot.
 */
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
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
    res.status(400).json({ success: false, verified: false, error: "Invalid payment signature" });
    return;
  }

  await confirmAndFulfilMall(
    req,
    res,
    String(razorpay_order_id),
    String(razorpay_payment_id),
    "VERIFY",
    "Payment verified successfully, orders created, and settlements scheduled on T+7 hold."
  );
});

/**
 * POST /api/payment/pay-with-card
 * Saved-card checkout. Same server pricing as create-order (`amount` here is in rupees, or
 * `amount_in_paise`; both optional, must match). The card is the signed-in user's Razorpay
 * token; card details are never sent to us.
 *
 * Real mode: `requires_checkout: true` with `customer_id` + `token_id`; the app completes the
 * payment in Razorpay Checkout and calls verify-payment (or verify-card-otp).
 * Stub mode only: simulated 3DS flow with a fake `pay_stub_*` payment id.
 */
export const payWithCard = asyncHandler(async (req: Request, res: Response) => {
  if (!requireBuyerInProduction(req, res)) return;
  const cardIdentifier = req.body?.card_id || req.body?.token_id;
  if (!cardIdentifier) {
    res.status(400).json({ success: false, error: "Card ID or Token ID is required for tokenized checkout" });
    return;
  }

  const userId = req.user?.id ?? null;
  const savedCard = userId ? await savedCardsService.findUserCard(userId, String(cardIdentifier)) : null;
  if (userId && !savedCard) {
    res.status(404).json({ success: false, code: "CARD_NOT_FOUND", error: "That saved card was not found on your account." });
    return;
  }

  const cart = await priceCheckoutRequest(req, res, "rupees");
  if (!cart) return;

  const customerId = userId ? await savedCardsService.customerIdFor(userId) : null;
  const { order } = await razorpayCheckoutService.createCheckout({
    purpose: "MALL",
    amountPaise: cart.totalPaise,
    currency: "INR",
    receipt: `cikka_card_${Date.now()}`,
    notes: { payment_type: "saved_card", card_last4: savedCard?.last4 || "" },
    userId,
    snapshot: checkoutSnapshot(cart, req.body),
  });

  const rawPhone = String(req.body?.customer_phone || "").replace(/\D/g, "");
  const cardInfo = {
    bank_name: savedCard?.bankName || "",
    card_network: savedCard?.cardNetwork || "",
    card_type: savedCard?.cardType || "credit",
    card_last4: savedCard?.last4 || "",
    phone_last4: rawPhone.length >= 4 ? rawPhone.slice(-4) : "",
  };
  const quote = toQuoteResponse(cart, userId);

  if (!isRazorpayStubMode()) {
    res.status(200).json({
      success: true,
      requires_otp: false,
      requires_checkout: true,
      order_id: order.order_id,
      payment_id: null,
      key_id: order.key_id,
      currency: order.currency,
      customer_id: customerId,
      token_id: savedCard?.razorpayTokenId ?? null,
      ...cardInfo,
      amount: order.amount / 100,
      amount_in_paise: order.amount,
      quote,
      message: "Complete the card payment in Razorpay Checkout, then verify it.",
    });
    return;
  }

  const paymentId = `${STUB_PAYMENT_PREFIX}${crypto.randomBytes(7).toString("hex")}`;
  res.status(200).json({
    success: true,
    requires_otp: true,
    order_id: order.order_id,
    payment_id: paymentId,
    customer_id: customerId,
    token_id: savedCard?.razorpayTokenId ?? null,
    ...cardInfo,
    amount: order.amount / 100,
    amount_in_paise: order.amount,
    quote,
    acs_url: null,
    message: `[Stub] 3D Secure OTP simulated for card ending ${cardInfo.card_last4 || "****"}`,
  });
});

/**
 * POST /api/payment/verify-card-otp
 * Completes a saved-card checkout. The OTP itself is handled by the bank/Razorpay; what we
 * check is the payment: it must exist at Razorpay, belong to `order_id`, be captured (captured
 * here if authorized) and match the order amount. Then the order is fulfilled once.
 */
export const verifyCardOtp = asyncHandler(async (req: Request, res: Response) => {
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

  await confirmAndFulfilMall(
    req,
    res,
    String(order_id),
    String(payment_id),
    "CARD_OTP",
    "Card payment verified. Order placed and fulfillment initiated."
  );
});
