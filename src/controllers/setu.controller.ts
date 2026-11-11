import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { SETU_ERRORS } from "../constants/errors";
import {
  recordPaymentStatusService,
  processRefundService,
  checkPaymentStatusService,
} from "../services/setu.service";
import {
  handleBillpayWebhook,
  verifyBillpayWebhookApiKey,
  type BillpayWebhookPayload,
} from "../services/billpayWebhook.service";

/**
 * POST /setu/v1/checkStatus (Check Status URL for WL + Custom Payment)
 * Accepts status query from Setu system and responds with standardized transaction status.
 */
export const checkStatus = asyncHandler(async (req: Request, res: Response) => {
  const uniquePaymentRefID =
    req.body?.uniquePaymentRefID ||
    req.body?.refID ||
    req.body?.setuTxnId ||
    (req.query?.uniquePaymentRefID as string) ||
    (req.query?.refID as string);

  if (!uniquePaymentRefID) {
    res.status(400).json({
      success: false,
      error: SETU_ERRORS.MISSING_REF_ID,
    });
    return;
  }

  const result = await checkPaymentStatusService({ uniquePaymentRefID });

  res.status(200).json({
    success: true,
    uniquePaymentRefID: result.uniquePaymentRefID,
    refID: result.refID,
    status: result.status,
    amount: result.amount,
    billerId: result.billerId,
    billerName: result.billerName,
    category: result.category,
    bbpsRefNo: result.bbpsRefNo,
    found: result.found,
  });
});

/**
 * POST /setu/v1/getPaymentStatus
 * Handle payment status notifications from Setu.
 */
export const getPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const refID =
    req.body?.refId ||
    req.body?.refID ||
    req.body?.uniquePaymentRefID ||
    req.body?.billId ||
    req.body?.sessionId;

  if (!refID) {
    res.status(400).json({
      status: 400,
      success: false,
      error: SETU_ERRORS.MISSING_REF_ID,
    });
    return;
  }

  const result = await recordPaymentStatusService(req.body);

  if (result.isDuplicate) {
    res.status(200).json({
      status: 200,
      success: true,
      message: "Transaction already processed (Idempotent response)",
      uniquePaymentRefID: result.uniquePaymentRefID,
      refId: result.refId || result.uniquePaymentRefID,
      statusStr: result.status,
      isDuplicate: true,
    });
    return;
  }

  res.status(200).json({
    status: 200,
    success: true,
    message: "Payment status recorded successfully",
    uniquePaymentRefID: result.uniquePaymentRefID,
    refId: result.refId || result.uniquePaymentRefID,
    statusStr: result.status,
    isDuplicate: false,
  });
});

/**
 * POST /setu/v1/refund
 * Handle refund notifications/requests from Setu.
 */
export const processRefund = asyncHandler(async (req: Request, res: Response) => {
  const { uniquePaymentRefID, refundRefID } = req.body;
  const dedupKey = refundRefID || uniquePaymentRefID;

  if (!dedupKey) {
    res.status(400).json({
      success: false,
      error: SETU_ERRORS.MISSING_REFUND_ID,
    });
    return;
  }

  try {
    const result = await processRefundService(req.body);

    if (result.isDuplicate) {
      res.status(200).json({
        success: true,
        message: "Refund already processed (Idempotent response)",
        uniquePaymentRefID: result.uniquePaymentRefID,
        status: result.status,
        isDuplicate: true,
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Refund processed successfully",
      uniquePaymentRefID: result.uniquePaymentRefID,
      status: result.status,
      refundAmount: result.refundAmount,
      isDuplicate: false,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || SETU_ERRORS.MISSING_REFUND_ID,
    });
  }
});

/**
 * POST /bills/fetch
 * Setu Bill Fetch webhook for mock/sandbox testing
 */
export const handleBillsFetch = asyncHandler(async (req: Request, res: Response) => {
  const customerIdentifiers = req.body?.customerIdentifiers || [];
  const primaryId = customerIdentifiers[0]?.attributeValue || req.body?.billerBillId || "TEST-BILL-1001";

  res.status(200).json({
    status: 200,
    success: true,
    data: {
      customer: {
        name: "Cikka Verified User",
      },
      billDetails: {
        billId: `BILL-${Date.now()}`,
        billDate: new Date().toISOString().split("T")[0],
        dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
        amountExactness: "EXACT",
        aggregates: {
          total: {
            displayName: "Total Amount Due",
            amountValue: 50000,
          },
        },
      },
    },
  });
});

/**
 * POST /bills/fetchReceipt
 */
export const handleBillsFetchReceipt = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    success: true,
    data: {
      receipt: {
        id: `RCP-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
      },
    },
  });
});

/**
 * POST /notifications, POST /api/bbps/webhook
 * Receives Setu BillPay webhooks (payment, refund, dispute, fetch events).
 * Authenticated with the X-BILL-WEBHOOK-API-KEY header; processed idempotently by
 * billpayWebhook.service. A processing error answers 500 so Setu retries.
 */
export const handleNotifications = asyncHandler(async (req: Request, res: Response) => {
  if (!verifyBillpayWebhookApiKey(req.headers["x-bill-webhook-api-key"])) {
    res.status(401).json({ success: false, error: "Invalid or missing webhook API key" });
    return;
  }

  const payload = req.body;
  if (!payload || typeof payload !== "object" || typeof payload.event !== "string" || !payload.event) {
    res.status(400).json({ success: false, error: "Webhook payload must include an event" });
    return;
  }

  try {
    const result = await handleBillpayWebhook(payload as BillpayWebhookPayload);
    res.status(200).json({ success: true, status: result.status });
  } catch (err: any) {
    console.error(`[Setu BillPay Webhook] Processing failed for event ${payload.event}: ${err?.message}`);
    res.status(500).json({ success: false, error: "Webhook processing failed" });
  }
});

