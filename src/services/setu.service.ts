import { prisma } from "../config/prisma";
import { SETU_ERRORS } from "../constants/errors";

export interface PaymentStatusDTO {
  uniquePaymentRefID: string;
  status?: string;
  amount?: number | string;
  userId?: string;
  orderId?: string;
  rawPayload?: any;
}

export interface RefundDTO {
  uniquePaymentRefID?: string;
  refundRefID?: string;
  amount?: number | string;
  userId?: string;
  orderId?: string;
  rawPayload?: any;
}

export async function recordPaymentStatusService(dto: PaymentStatusDTO) {
  const { uniquePaymentRefID, status, amount, userId, orderId, rawPayload } = dto;

  if (!uniquePaymentRefID) {
    throw new Error(SETU_ERRORS.MISSING_REF_ID);
  }

  // 1. Idempotency & Deduplication Check
  const existingTransaction = await prisma.paymentTransaction.findUnique({
    where: { uniquePaymentRefID },
  });

  if (existingTransaction) {
    return {
      isDuplicate: true,
      uniquePaymentRefID,
      status: existingTransaction.status,
    };
  }

  // 2. Process new transaction
  const txAmount = amount !== undefined && amount !== null ? parseFloat(amount.toString()) : 0;
  const paymentStatus = (status || "SUCCESS").toUpperCase();

  await prisma.paymentTransaction.create({
    data: {
      uniquePaymentRefID,
      userId: userId || null,
      orderId: orderId || null,
      amount: txAmount,
      status: paymentStatus,
      rawPayload: rawPayload || null,
    },
  });

  return {
    isDuplicate: false,
    uniquePaymentRefID,
    status: paymentStatus,
  };
}

export async function processRefundService(dto: RefundDTO) {
  const { uniquePaymentRefID, refundRefID, amount, userId, orderId, rawPayload } = dto;
  const dedupKey = refundRefID || uniquePaymentRefID;

  if (!dedupKey) {
    throw new Error(SETU_ERRORS.MISSING_REFUND_ID);
  }

  // 1. Idempotency Check
  const existingRefund = await prisma.paymentTransaction.findUnique({
    where: { uniquePaymentRefID: dedupKey },
  });

  if (existingRefund) {
    return {
      isDuplicate: true,
      uniquePaymentRefID: dedupKey,
      status: existingRefund.status,
      refundAmount: parseFloat(existingRefund.amount.toString()),
    };
  }

  // 2. Process Refund
  const refundAmount = amount !== undefined && amount !== null ? parseFloat(amount.toString()) : 0;

  await prisma.paymentTransaction.create({
    data: {
      uniquePaymentRefID: dedupKey,
      userId: userId || null,
      orderId: orderId || null,
      amount: refundAmount,
      status: "REFUNDED",
      rawPayload: rawPayload || null,
    },
  });

  return {
    isDuplicate: false,
    uniquePaymentRefID: dedupKey,
    status: "REFUNDED",
    refundAmount,
  };
}
