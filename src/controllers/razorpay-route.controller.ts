import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { razorpayRouteService } from "../services/razorpayRoute.service";
import { disburseSettlement } from "../services/settlement.service";

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
  const signature = (req.headers["x-razorpay-signature"] as string) || "";
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  // If signature is supplied, verify it
  if (signature && process.env.RAZORPAY_WEBHOOK_SECRET) {
    const isValid = razorpayRouteService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      console.warn("[Razorpay Route Webhook] Invalid webhook signature received.");
      res.status(400).json({ success: false, error: "Invalid webhook signature" });
      return;
    }
  }

  const event = req.body?.event;
  const payload = req.body?.payload || {};
  console.log(`[Razorpay Route Webhook] Event received: ${event}`);

  try {
    switch (event) {
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
    console.error(`[Razorpay Route Webhook Error] ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
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
  const sellerId = req.seller?.id || req.body.sellerId;
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
  const result = await razorpayRouteService.createLinkedAccount({
    sellerId: seller.id,
    businessName: seller.businessName || onboarding?.businessName || "Merchant Partner",
    businessType: onboarding?.businessType as any,
    email: seller.email || onboarding?.signatoryEmail || "seller@cikka.club",
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
