import { prisma } from "../config/prisma";
import { SETU_ERRORS } from "../constants/errors";
import { setuBbpsService } from "../external/setu/setu-bbps.client";

export interface PaymentStatusDTO {
  uniquePaymentRefID?: string;
  refId?: string;
  refID?: string;
  billId?: string;
  sessionId?: string;
  status?: string;
  event?: string;
  amount?: number | string;
  billAmount?: number | string;
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
  const refID =
    dto.uniquePaymentRefID ||
    dto.refId ||
    dto.refID ||
    dto.billId ||
    dto.sessionId;

  if (!refID) {
    throw new Error(SETU_ERRORS.MISSING_REF_ID);
  }

  const rawStatus = dto.status || dto.event || "SUCCESS";
  const paymentStatus = rawStatus.toUpperCase();
  const numAmount = dto.amount ?? dto.billAmount;
  const txAmount = numAmount !== undefined && numAmount !== null ? parseFloat(numAmount.toString()) : 0;

  // 1. Idempotency & Deduplication Check on PaymentTransaction
  const existingTransaction = await prisma.paymentTransaction.findUnique({
    where: { uniquePaymentRefID: refID },
  });

  if (existingTransaction) {
    // Also update BbpsTransaction if it exists
    await syncBbpsTransactionStatus(refID, paymentStatus, dto.rawPayload || dto);

    return {
      isDuplicate: true,
      uniquePaymentRefID: refID,
      refId: refID,
      status: existingTransaction.status,
    };
  }

  // 2. Process new transaction
  try {
    await prisma.paymentTransaction.create({
      data: {
        uniquePaymentRefID: refID,
        userId: dto.userId || null,
        orderId: dto.orderId || null,
        amount: txAmount,
        status: paymentStatus,
        rawPayload: dto.rawPayload || dto || null,
      },
    });
  } catch (err: any) {
    console.warn(`[Setu Service Warning] DB logging skipped: ${err.message}`);
  }

  // 3. Sync status to BbpsTransaction ledger if matching refID exists
  await syncBbpsTransactionStatus(refID, paymentStatus, dto.rawPayload || dto);

  return {
    isDuplicate: false,
    uniquePaymentRefID: refID,
    refId: refID,
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

  // Sync to BBPS ledger
  if (uniquePaymentRefID) {
    await syncBbpsTransactionStatus(uniquePaymentRefID, "REFUNDED", rawPayload);
  }

  return {
    isDuplicate: false,
    uniquePaymentRefID: dedupKey,
    status: "REFUNDED",
    refundAmount,
  };
}

export interface CheckStatusDTO {
  uniquePaymentRefID?: string;
  refID?: string;
  setuTxnId?: string;
}

export async function checkPaymentStatusService(dto: CheckStatusDTO) {
  const refID = dto.uniquePaymentRefID || dto.refID || dto.setuTxnId;

  if (!refID) {
    throw new Error(SETU_ERRORS.MISSING_REF_ID);
  }

  // 1. Check BBPS Transactions table
  const bbpsTx = await prisma.bbpsTransaction.findUnique({
    where: { refID },
  });

  if (bbpsTx) {
    return {
      found: true,
      uniquePaymentRefID: bbpsTx.refID,
      refID: bbpsTx.refID,
      status: bbpsTx.status,
      amount: parseFloat(bbpsTx.amount.toString()),
      billerId: bbpsTx.billerId,
      billerName: bbpsTx.billerName,
      category: bbpsTx.category,
      bbpsRefNo: bbpsTx.bbpsRefNo,
      updatedAt: bbpsTx.updatedAt,
      rawPayload: bbpsTx.rawPayload,
    };
  }

  // 2. Check general Payment Transactions table
  const genTx = await prisma.paymentTransaction.findUnique({
    where: { uniquePaymentRefID: refID },
  });

  if (genTx) {
    return {
      found: true,
      uniquePaymentRefID: genTx.uniquePaymentRefID,
      refID: genTx.uniquePaymentRefID,
      status: genTx.status,
      amount: parseFloat(genTx.amount.toString()),
      updatedAt: genTx.updatedAt,
      rawPayload: genTx.rawPayload,
    };
  }

  // 3. Fallback: Query Setu gateway service
  try {
    const gatewayResult = await setuBbpsService.checkStatus(refID);
    if (gatewayResult) {
      return {
        found: true,
        uniquePaymentRefID: gatewayResult.refID,
        refID: gatewayResult.refID,
        status: gatewayResult.status,
        amount: gatewayResult.amount,
        bbpsRefNo: gatewayResult.bbpsRefNo,
        rawPayload: gatewayResult.rawPayload,
      };
    }
  } catch (_err) {
    // Gateway fallback failed or refID unknown
  }

  return {
    found: false,
    uniquePaymentRefID: refID,
    refID,
    status: "PENDING",
    message: "Transaction refID not found in local ledger",
  };
}

async function syncBbpsTransactionStatus(refID: string, status: string, rawPayload?: any) {
  try {
    const bbpsTx = await prisma.bbpsTransaction.findUnique({ where: { refID } });
    if (bbpsTx) {
      await prisma.bbpsTransaction.update({
        where: { refID },
        data: {
          status,
          rawPayload: rawPayload || bbpsTx.rawPayload,
        },
      });
    }
  } catch (_err) {
    // Ignore if table or row not present
  }
}

