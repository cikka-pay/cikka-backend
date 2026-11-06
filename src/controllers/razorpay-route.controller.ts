import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { razorpayRouteService } from "../services/razorpayRoute.service";
import { disburseSettlement } from "../services/settlement.service";
import { config } from "../config/env";
import { razorpayCheckoutService, PaymentVerificationError } from "../services/razorpayCheckout.service";
import { fulfilMallCheckout } from "./payment.controller";
import { fulfilRewardsCheckout } from "./rewards.controller";

/**
 * payment.captured / order.paid: fulfil the order if the app never called verify.
 * Idempotent through the same checkout claim as verify-payment / verify-card-otp, so
 * redeliveries and races with the client are safe. Returns a short status for the response.
 */
async function handleCapturedPaymentEvent(payload: any): Promise<string> {
  const payment = payload?.payment?.entity;
  const orderEntity = payload?.order?.entity;
  const orderId: string | undefined = payment?.order_id || orderEntity?.id;
  const paymentId: string | undefined = payment?.id;

  if (!orderId || !paymentId) return "ignored: no order/payment id";
  if (payment.status !== "captured") return `ignored: payment ${payment.status}`;

  const checkout = await razorpayCheckoutService.findByOrderId(orderId);
  if (!checkout) return "ignored: unknown order";

  const amountPaise = Number(payment.amount);
  if (amountPaise !== checkout.amountPaise || (payment.currency || "INR") !== checkout.currency) {
    console.error(
      `[Razorpay Webhook] Amount mismatch on ${orderId}: paid ${payment.amount} ${payment.currency}, expected ${checkout.amountPaise} ${checkout.currency}`
    );
    await razorpayCheckoutService.markPaidAwaitingDetails(orderId, paymentId, "AMOUNT_MISMATCH");
    return "rejected: amount mismatch";
  }

  const snap = ((checkout.snapshot as any) || {}) as Record<string, any>;
  if (checkout.purpose === "MALL" && !(Array.isArray(snap.items) && snap.items.length > 0)) {
    // Order created without a cart (current app create-order call): wait for verify-payment.
    await razorpayCheckoutService.markPaidAwaitingDetails(orderId, paymentId, "PAID_AWAITING_CART");
    return "deferred: no cart recorded";
  }
  if (checkout.purpose === "REWARDS" && !(snap.delivery_address && snap.pincode)) {
    await razorpayCheckoutService.markPaidAwaitingDetails(orderId, paymentId, "PAID_AWAITING_ADDRESS");
    return "deferred: no delivery address recorded";
  }

  const outcome = await razorpayCheckoutService.fulfilOnce({
    orderId,
    paymentId,
    purpose: checkout.purpose as "MALL" | "REWARDS",
    amountPaise,
    currency: checkout.currency,
    userId: checkout.userId,
    via: "WEBHOOK",
    fulfil: (row) =>
      row.purpose === "REWARDS"
        ? fulfilRewardsCheckout(row, paymentId, amountPaise, {}, row.userId)
        : fulfilMallCheckout(row, paymentId, amountPaise),
  });
  return outcome.state.toLowerCase();
}

/**
 * POST /api/razorpay-route/webhook
 * Webhook endpoint for Razorpay Route events:
 * - transfer.processed
 * - transfer.failed
 * - transfer.reversed
 * - settlement.processed
 * - account.activated
 */
export const handleRouteWebhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = String(req.headers["x-razorpay-signature"] || "");
  const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || config.razorpayWebhookSecret || "").trim();

  if (!webhookSecret) {
    console.error("[Razorpay Webhook] RAZORPAY_WEBHOOK_SECRET is not configured; rejecting webhook.");
    res.status(401).json({ success: false, error: "Webhook secret not configured" });
    return;
  }
  if (!signature) {
    res.status(401).json({ success: false, error: "Missing X-Razorpay-Signature" });
    return;
  }
  // Verify over the exact bytes received; never over re-serialised JSON.
  if (!req.rawBody || !razorpayRouteService.verifyWebhookSignature(req.rawBody, signature)) {
    console.warn("[Razorpay Webhook] Invalid webhook signature received.");
    res.status(400).json({ success: false, error: "Invalid webhook signature" });
    return;
  }

  const event = req.body?.event;
  const payload = req.body?.payload || {};
  console.log(`[Razorpay Route Webhook] Event received: ${event}`);

  try {
    switch (event) {
      case "payment.captured":
      case "order.paid": {
        const status = await handleCapturedPaymentEvent(payload);
        console.log(`[Razorpay Webhook] ${event}: ${status}`);
        break;
      }

      case "transfer.failed":
      case "transfers.failed": {
        const transferId = payload.transfer?.entity?.id;
        if (transferId) {
          await prisma.settlement.updateMany({
            where: { razorpayTransferId: transferId },
            data: { transferStatus: "FAILED", failureReason: "Razorpay reported the transfer as failed" } as any,
          });
        }
        break;
      }

      case "transfer.processed": {
        const transfer = payload.transfer?.entity;
        const transferId = transfer?.id;
        const utr = transfer?.recipient_settlement_id || transfer?.utr;

        if (transferId) {
          await prisma.settlement.updateMany({
            where: { razorpayTransferId: transferId },
            data: {
              status: transfer.on_hold ? "PENDING" : "PAID",
              transferStatus: transfer.on_hold ? "ON_HOLD" : "SETTLED",
              utr: utr || undefined,
            } as any,
          });
        }
        break;
      }

      case "settlement.processed": {
        const settlementEntity = payload.settlement?.entity;
        const utr = settlementEntity?.utr || settlementEntity?.bank_reference;
        const accountId = req.body?.account_id;

        console.log(`[Razorpay Route Webhook] Bank Settlement processed for account ${accountId}, UTR: ${utr}`);
        if (accountId) {
          await prisma.settlement.updateMany({
            where: {
              seller: { razorpayAccountId: accountId },
              transferStatus: "ON_HOLD",
            },
            data: {
              status: "PAID",
              transferStatus: "SETTLED",
              utr: utr || undefined,
              disbursedAt: new Date(),
            } as any,
          });
        }
        break;
      }

      case "transfer.reversed": {
        const reversal = payload.reversal?.entity;
        const transferId = reversal?.transfer_id;

        if (transferId) {
          await prisma.settlement.updateMany({
            where: { razorpayTransferId: transferId },
            data: {
              transferStatus: "REVERSED",
            } as any,
          });
        }
        break;
      }

      case "account.activated": {
        const account = payload.account?.entity;
        const accountId = account?.id;
        const email = account?.email;

        if (accountId) {
          await prisma.seller.updateMany({
            where: {
              OR: [{ razorpayAccountId: accountId }, email ? { email } : undefined].filter(Boolean) as any[],
            },
            data: {
              razorpayAccountId: accountId,
              razorpayAccountStatus: "ACTIVATED",
            } as any,
          });
        }
        break;
      }

      default:
        console.log(`[Razorpay Route Webhook] Unhandled event: ${event}`);
    }

    res.status(200).json({ success: true, message: "Webhook processed successfully", event });
  } catch (error: any) {
    // Non-2xx makes Razorpay redeliver (with backoff, for 24h); fulfilment is idempotent.
    console.error(`[Razorpay Webhook Error] ${event}: ${error.message}`);
    const status = error instanceof PaymentVerificationError ? 200 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/razorpay-route/disburse/:id
 * Allows manual or automated trigger to disburse/schedule Route transfer or release hold
 */
export const triggerRouteDisburse = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { forceEarlyRelease, paymentId } = req.body || {};

  try {
    const result = await disburseSettlement(id, { forceEarlyRelease, paymentId });
    if (result.success) {
      res.status(200).json({
        success: true,
        message: "Razorpay Route settlement processed successfully (T+7).",
        data: result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Failed to process settlement via Razorpay Route.",
        data: result,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "An error occurred during Razorpay Route settlement disbursal.",
    });
  }
});

/**
 * POST /api/razorpay-route/create-account
 * Manually creates or syncs a seller's linked account on Razorpay Route
 */
export const createLinkedAccountHandler = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.body?.sellerId;
  if (!sellerId) {
    res.status(400).json({ success: false, error: "Seller ID is required" });
    return;
  }

  const seller = await prisma.seller.findFirst({
    where: {
      OR: [
        { id: sellerId },
        { onboarding: { applicationId: sellerId } },
      ],
    },
    include: { onboarding: true },
  });

  if (!seller) {
    res.status(404).json({ success: false, error: "Seller not found" });
    return;
  }

  const onboarding = seller.onboarding;
  const targetEmail = (seller.email && seller.email.trim())
    || (onboarding?.signatoryEmail && onboarding.signatoryEmail.trim());

  if (!targetEmail) {
    res.status(400).json({ success: false, error: "Seller verified email is required to create a Razorpay Route linked account." });
    return;
  }

  const result = await razorpayRouteService.createLinkedAccount({
    sellerId: seller.id,
    businessName: seller.businessName || onboarding?.businessName || "Merchant Partner",
    businessType: onboarding?.businessType as any,
    email: targetEmail,
    phone: seller.phone,
    signatoryName: onboarding?.signatoryName || undefined,
    panNumber: onboarding?.panNumber || onboarding?.signatoryPersonalPan || undefined,
    gstNumber: onboarding?.gstNumber || undefined,
    bankAccountNumber: onboarding?.bankAccountNumber || undefined,
    bankIfsc: onboarding?.bankIfsc || undefined,
    bankAccountHolder: onboarding?.bankAccountHolder || undefined,
    address: onboarding?.pickupAddress as any,
  });

  if (result.success) {
    res.status(200).json({
      success: true,
      message: "Razorpay Route linked account created successfully",
      accountId: result.accountId,
      status: result.status,
    });
  } else {
    res.status(400).json({
      success: false,
      error: result.error || "Failed to create Razorpay Route linked account",
    });
  }
});

/**
 * POST /api/razorpay-route/process-eligible-holds
 * POST /api/razorpay-route/process-eligible
 * Releases holds on Razorpay Route for all settlements whose T+7 return window has elapsed.
 */
export const processEligibleSettlementsHandler = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const eligibleSettlements = await prisma.settlement.findMany({
    where: {
      transferStatus: "ON_HOLD",
      holdUntil: { lte: now },
      razorpayTransferId: { not: null },
    },
    include: { seller: true },
  });

  const results: any[] = [];
  for (const s of eligibleSettlements) {
    if (!s.razorpayTransferId) continue;
    try {
      const releaseRes = await razorpayRouteService.releaseTransferHold(s.razorpayTransferId);
      if (releaseRes.success) {
        const updated = await prisma.settlement.update({
          where: { id: s.id },
          data: {
            status: "PAID",
            transferStatus: "SETTLED",
            disbursedAt: new Date(),
          } as any,
        });

        await prisma.notification.create({
          data: {
            sellerId: s.sellerId,
            type: "SETTLEMENT",
            title: `Settlement Paid: ₹${Number(s.netPayable).toFixed(2)}`,
            body: `T+7 return window completed. Funds have been released and settled to your linked bank account.`,
            metadata: {
              settlementId: s.id,
              transferId: s.razorpayTransferId,
              amount: Number(s.netPayable),
            },
          },
        }).catch(() => {});

        results.push({
          settlementId: s.id,
          transferId: s.razorpayTransferId,
          status: "SETTLED",
          netPayable: Number(s.netPayable),
        });
      } else {
        results.push({
          settlementId: s.id,
          transferId: s.razorpayTransferId,
          status: "FAILED",
          error: releaseRes.error,
        });
      }
    } catch (e: any) {
      results.push({
        settlementId: s.id,
        transferId: s.razorpayTransferId,
        status: "ERROR",
        error: e.message,
      });
    }
  }

  res.status(200).json({
    success: true,
    message: `Processed ${eligibleSettlements.length} eligible settlements`,
    disbursedCount: results.filter((r) => r.status === "SETTLED").length,
    results,
  });
});

