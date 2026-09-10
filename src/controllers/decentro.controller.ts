import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { disburseSettlement } from "../services/settlement.service";

/**
 * POST /api/decentro/payout-webhook
 * Webhook endpoint for Decentro money transfer status callbacks
 */
export const handleDecentroPayoutWebhook = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body || {};
  console.log(`[DECENTRO WEBHOOK RECEIVED]`, JSON.stringify(body));

  const decentroTxnId = body.decentroTxnId || body.decentro_txn_id || body.data?.decentroTxnId;
  const referenceId = body.reference_id || body.referenceId || body.data?.reference_id;
  const status = body.status || body.transactionStatus || body.data?.transactionStatus;
  const utr = body.bankReferenceNumber || body.utr || body.data?.bankReferenceNumber || body.data?.utr;
  const errorMsg = body.message || body.failureReason || body.data?.message;

  if (!decentroTxnId && !referenceId) {
    res.status(400).json({ success: false, error: "Missing decentroTxnId or reference_id in webhook payload." });
    return;
  }

  // Find matching settlement
  const settlement = await prisma.settlement.findFirst({
    where: {
      OR: [
        decentroTxnId ? { decentroTxnId } : undefined,
        referenceId ? { id: referenceId.replace("SET_", "") } : undefined,
      ].filter(Boolean) as any[],
    },
  });

  if (!settlement) {
    console.warn(`[DECENTRO WEBHOOK] No matching settlement found for decentroTxnId=${decentroTxnId}, refId=${referenceId}`);
    res.status(200).json({ success: true, message: "Webhook acknowledged (no matching settlement found)." });
    return;
  }

  if (status === "SUCCESS") {
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        status: "PAID",
        utr: utr || settlement.utr,
        disbursedAt: new Date(),
        failureReason: null,
      } as any,
    });

    await prisma.notification.create({
      data: {
        sellerId: settlement.sellerId,
        type: "SETTLEMENT",
        title: "Payout Confirmed by Bank",
        body: `Your payout of ₹${Number(settlement.netPayable).toFixed(2)} has been credited to your bank account (UTR: ${utr || "N/A"}).`,
        metadata: { settlementId: settlement.id, utr },
      },
    });

    console.log(`[DECENTRO WEBHOOK] Settlement ${settlement.id} updated to PAID with UTR ${utr}`);
  } else if (status === "FAILURE" || status === "FAILED") {
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        failureReason: errorMsg || "Payout failed during bank transfer.",
      } as any,
    });

    console.log(`[DECENTRO WEBHOOK] Settlement ${settlement.id} payout failed: ${errorMsg}`);
  }

  res.status(200).json({ success: true, message: "Decentro payout webhook processed successfully." });
});

/**
 * POST /api/settlements/:id/disburse
 * Allows manual/admin or seller trigger of payout disburse for a settlement
 */
export const triggerPayoutDisburse = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const result = await disburseSettlement(id);
    if (result.success) {
      res.status(200).json({
        success: true,
        message: "Payout disburse initiated successfully.",
        data: result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || "Failed to disburse payout via Decentro.",
        data: result,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "An unexpected error occurred during payout disburse.",
    });
  }
});
