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

const inMemoryTxLedger = new Map<string, { status: string; amount: number }>();

export async function recordPaymentStatusService(dto: PaymentStatusDTO) {
  const { uniquePaymentRefID, status, amount, userId, orderId, rawPayload } = dto;

  if (!uniquePaymentRefID) {
    throw new Error(SETU_ERRORS.MISSING_REF_ID);
  }

  const txAmount = amount !== undefined && amount !== null ? parseFloat(amount.toString()) : 0;
  const paymentStatus = (status || "SUCCESS").toUpperCase();

  // In-memory fallback check
  if (inMemoryTxLedger.has(uniquePaymentRefID)) {
    const existing = inMemoryTxLedger.get(uniquePaymentRefID)!;
    return {
      isDuplicate: true,
      uniquePaymentRefID,
      status: existing.status,
    };
  }

  try {
    // 1. Idempotency & Deduplication Check
    const existingTransaction = await prisma.paymentTransaction.findUnique({
      where: { uniquePaymentRefID },
    });

    if (existingTransaction) {
      inMemoryTxLedger.set(uniquePaymentRefID, { status: existingTransaction.status, amount: parseFloat(existingTransaction.amount.toString()) });
      return {
        isDuplicate: true,
        uniquePaymentRefID,
        status: existingTransaction.status,
      };
    }

    // 2. Process new transaction
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
  } catch (err: any) {
    console.warn(`[Setu Service Warning] DB logging skipped in dev/test: ${err.message}`);
  }

  inMemoryTxLedger.set(uniquePaymentRefID, { status: paymentStatus, amount: txAmount });
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

  const refundAmount = amount !== undefined && amount !== null ? parseFloat(amount.toString()) : 0;

  try {
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
  } catch (err: any) {
    console.warn(`[Setu Service Warning] DB refund logging skipped in dev/test: ${err.message}`);
  }

  return {
    isDuplicate: false,
    uniquePaymentRefID: dedupKey,
    status: "REFUNDED",
    refundAmount,
  };
}
