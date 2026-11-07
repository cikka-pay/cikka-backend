import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { razorpayCheckoutService, PaymentVerificationError } from "../services/razorpayCheckout.service";
import { completeTransfers, fulfilMallCheckout, fulfilRewardsCheckout } from "../services/checkoutFulfilment.service";
import { mallBeforeCapture } from "./payment.controller";

/**
 * GET /api/admin/checkouts?status=stuck|PROCESSING|FAILED|REFUNDED|FULFILLED&limit=50
 * "stuck" (default): FAILED, PROCESSING with an expired lease, or FULFILLED with seller
 * transfers still pending/failed (spec 003 §5).
 */
export const listCheckouts = asyncHandler(async (req: Request, res: Response) => {
  const status = String(req.query.status || "stuck");
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const now = new Date();
  const where =
    status === "stuck"
      ? {
          OR: [
            { status: "FAILED" },
            { status: "PROCESSING", OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }] },
            { status: "FULFILLED", stage: "DB_COMMITTED" },
          ],
        }
      : { status };
  const rows = await prisma.razorpayCheckout.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit });
  res.json({
    success: true,
    data: rows.map((r) => ({
      razorpay_order_id: r.razorpayOrderId,
      purpose: r.purpose,
      user_id: r.userId,
      amount_paise: r.amountPaise,
      status: r.status,
      stage: r.stage,
      attempts: r.attempts,
      lease_expires_at: r.leaseExpiresAt,
      razorpay_payment_id: r.razorpayPaymentId,
      last_error: r.lastError,
      updated_at: r.updatedAt,
    })),
  });
});

/**
 * POST /api/admin/checkouts/:razorpayOrderId/resume  { paymentId?, force? }
 * Re-confirms the payment with Razorpay, then resumes fulfilment (FAILED / expired lease;
 * `force: true` expires a live lease first) or, for a FULFILLED checkout, retries the seller
 * transfers that are still pending or failed.
 */
export const resumeCheckout = asyncHandler(async (req: Request, res: Response) => {
  const orderId = req.params.razorpayOrderId;
  const checkout = await razorpayCheckoutService.findByOrderId(orderId);
  if (!checkout) {
    res.status(404).json({ success: false, error: "Unknown checkout" });
    return;
  }
  const paymentId = checkout.razorpayPaymentId || req.body?.paymentId;
  if (!paymentId) {
    res.status(409).json({ success: false, error: "No payment recorded for this checkout; pass paymentId" });
    return;
  }
  if (checkout.status === "REFUNDED") {
    res.status(409).json({ success: false, error: "This checkout was rejected and refunded", result: checkout.result });
    return;
  }

  try {
    const confirmed = await razorpayCheckoutService.confirmCapturedPayment({
      orderId,
      paymentId: String(paymentId),
      purpose: checkout.purpose as "MALL" | "REWARDS",
      beforeCapture: checkout.purpose === "MALL" ? mallBeforeCapture : undefined,
    });

    if (checkout.status === "FULFILLED") {
      const transfers = await completeTransfers(orderId, String(paymentId));
      res.json({ success: true, state: "FULFILLED", transfers });
      return;
    }

    if (req.body?.force === true && checkout.status === "PROCESSING") {
      await prisma.razorpayCheckout.update({ where: { razorpayOrderId: orderId }, data: { leaseExpiresAt: new Date(0) } });
    }

    const outcome = await razorpayCheckoutService.fulfilOnce({
      orderId,
      paymentId: String(paymentId),
      purpose: checkout.purpose as "MALL" | "REWARDS",
      amountPaise: confirmed.amountPaise,
      currency: confirmed.payment.currency,
      userId: checkout.userId,
      via: "ADMIN",
      fulfil: (row) =>
        row.purpose === "REWARDS"
          ? fulfilRewardsCheckout(row, String(paymentId), confirmed.amountPaise)
          : fulfilMallCheckout(row, String(paymentId), confirmed.amountPaise),
    });
    const status = outcome.state === "IN_PROGRESS" ? 409 : 200;
    res.status(status).json({
      success: outcome.state !== "IN_PROGRESS",
      state: outcome.state,
      result: outcome.result,
      ...(outcome.state === "IN_PROGRESS" ? { error: "Another worker holds a live lease; retry later or pass force: true" } : {}),
    });
  } catch (err: any) {
    if (err instanceof PaymentVerificationError) {
      res.status(err.status).json({ success: false, code: err.code, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: err.message || "Resume failed" });
  }
});
