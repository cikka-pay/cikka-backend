import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * POST /setu/v1/getPaymentStatus
 * Handle payment status notifications from Setu.
 * Requirements:
 * 1. Must respond within 30 seconds.
 * 2. Idempotent check on uniquePaymentRefID:
 *    - If new: process transaction, credit CI Points, return 200 OK.
 *    - If already processed: return 200 OK immediately without re-triggering CI Points.
 */
export const getPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const {
    uniquePaymentRefID,
    status,
    amount,
    customerId,
    orderId,
    ciPoints,
    rawPayload,
  } = req.body;

  if (!uniquePaymentRefID) {
    res.status(400).json({
      success: false,
      error: "Missing required field: uniquePaymentRefID",
    });
    return;
  }

  // 1. Idempotency & Deduplication Check
  const existingTransaction = await prisma.paymentTransaction.findUnique({
    where: { uniquePaymentRefID },
  });

  if (existingTransaction) {
    // Already processed — respond with 200 OK immediately
    res.status(200).json({
      success: true,
      message: "Transaction already processed (Idempotent response)",
      uniquePaymentRefID,
      status: existingTransaction.status,
      ciPointsAwarded: existingTransaction.ciPointsAwarded,
      isDuplicate: true,
    });
    return;
  }

  // 2. Process new transaction
  const txAmount = amount ? parseFloat(amount.toString()) : 0;
  const paymentStatus = (status || "SUCCESS").toUpperCase();

  // Calculate CI Points (default: 1 CI Point per ₹100 spent if not explicitly provided)
  const awardedPoints =
    ciPoints !== undefined
      ? parseInt(ciPoints.toString(), 10)
      : paymentStatus === "SUCCESS"
      ? Math.floor(txAmount / 100)
      : 0;

  // Record payment in database
  const transaction = await prisma.paymentTransaction.create({
    data: {
      uniquePaymentRefID,
      customerId: customerId || null,
      orderId: orderId || null,
      amount: txAmount,
      status: paymentStatus,
      ciPointsAwarded: awardedPoints,
      rawPayload: rawPayload || req.body,
    },
  });

  // 3. Update customer CI Points balance if payment succeeded and customerId is present
  if (paymentStatus === "SUCCESS" && customerId && awardedPoints > 0) {
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        ciPointsBalance: {
          increment: awardedPoints,
        },
      },
    }).catch(() => {
      // Log or swallow if customer ID not found in dev
    });
  }

  res.status(200).json({
    success: true,
    message: "Payment status recorded successfully",
    uniquePaymentRefID,
    status: paymentStatus,
    ciPointsAwarded: awardedPoints,
    isDuplicate: false,
  });
});

/**
 * POST /setu/v1/refund
 * Handle refund notifications/requests from Setu.
 * Requirements: Same idempotency rules apply on uniquePaymentRefID.
 */
export const processRefund = asyncHandler(async (req: Request, res: Response) => {
  const {
    uniquePaymentRefID,
    refundRefID,
    amount,
    customerId,
    orderId,
    reason,
    rawPayload,
  } = req.body;

  const dedupKey = refundRefID || uniquePaymentRefID;

  if (!dedupKey) {
    res.status(400).json({
      success: false,
      error: "Missing required field: uniquePaymentRefID or refundRefID",
    });
    return;
  }

  // 1. Idempotency Check
  const existingRefund = await prisma.paymentTransaction.findUnique({
    where: { uniquePaymentRefID: dedupKey },
  });

  if (existingRefund) {
    res.status(200).json({
      success: true,
      message: "Refund already processed (Idempotent response)",
      uniquePaymentRefID: dedupKey,
      status: existingRefund.status,
      isDuplicate: true,
    });
    return;
  }

  // 2. Process Refund
  const refundAmount = amount ? parseFloat(amount.toString()) : 0;

  const refundTransaction = await prisma.paymentTransaction.create({
    data: {
      uniquePaymentRefID: dedupKey,
      customerId: customerId || null,
      orderId: orderId || null,
      amount: refundAmount,
      status: "REFUNDED",
      ciPointsAwarded: 0,
      rawPayload: rawPayload || req.body,
    },
  });

  res.status(200).json({
    success: true,
    message: "Refund processed successfully",
    uniquePaymentRefID: dedupKey,
    status: "REFUNDED",
    refundAmount,
    isDuplicate: false,
  });
});
