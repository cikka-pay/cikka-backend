import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { SETU_ERRORS } from "../constants/errors";
import {
  recordPaymentStatusService,
  processRefundService,
  checkPaymentStatusService,
} from "../services/setu.service";

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

  const { uniquePaymentRefID } = req.body;

  if (!uniquePaymentRefID) {
    res.status(400).json({
      success: false,
      error: SETU_ERRORS.MISSING_REF_ID,
    });
    return;
  }

  const result = await recordPaymentStatusService(req.body);

  if (result.isDuplicate) {
    res.status(200).json({
      success: true,
      message: "Transaction already processed (Idempotent response)",
      uniquePaymentRefID: result.uniquePaymentRefID,
      status: result.status,
      isDuplicate: true,
    });
    return;
  }

  res.status(200).json({
    success: true,
    message: "Payment status recorded successfully",
    uniquePaymentRefID: result.uniquePaymentRefID,
    status: result.status,
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
