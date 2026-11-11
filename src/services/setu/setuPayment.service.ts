import { config } from "../../config/env";
import { prisma } from "../../config/prisma";
import { getSetuHeaders } from "./setuAuth.service";
import { getBillDetailsService } from "./setuBill.service";
import { getBillerDetailsService } from "./setuBiller.service";
import { RewardsCalcService } from "../rewardsCalc.service";
import { walletService } from "../wallet.service";
import { razorpayService } from "../razorpay.service";
import { WalletTxType, Prisma } from "../../generated/prisma/client";

export interface InitiatePaymentInput {
  userId?: string | null;
  platformBillId: string;
  billerId?: string;
  amount: number;
  paymentMode?: string; // UPI | DEBIT_CARD | NET_BANKING
  customerParams?: Record<string, string>;
  idempotencyKey?: string;
  paymentRef?: string;
  /** Proof that the customer paid Cikka (required whenever real Setu / production is in use). */
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}

export interface PaymentFulfilmentResult {
  isDuplicate: boolean;
  internalTxnId: string;
  refID: string;
  platformBillId: string;
  billerId: string;
  billerName: string;
  amount: number;
  paymentMode: string;
  status: "INITIATED" | "VALIDATING" | "BILL_FETCHED" | "PAYMENT_PROCESSING" | "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED" | "RECONCILIATION_REQUIRED";
  bbpsRefNo?: string | null;
  receiptNumber?: string | null;
  receiptDate?: string | null;
  rewards?: {
    cashbackEarned: number;
    ciPointsEarned: number;
  };
  rawPayload?: any;
}

/** Error carrying the HTTP status the controller should answer with. */
export class BbpsPaymentError extends Error {
  constructor(message: string, public readonly httpStatus: number = 400) {
    super(message);
    this.name = "BbpsPaymentError";
  }
}

/**
 * In-memory fallback store, used ONLY in stub mode (local dev / tests without a database).
 * Never consulted when real Setu services or production are in use.
 */
export const inMemoryTransactions = new Map<string, any>();
const IN_MEMORY_LIMIT = 1000;

function rememberInMemory(key: string, value: any) {
  inMemoryTransactions.set(key, value);
  while (inMemoryTransactions.size > IN_MEMORY_LIMIT) {
    const oldest = inMemoryTransactions.keys().next().value;
    if (oldest === undefined) break;
    inMemoryTransactions.delete(oldest);
  }
}

function isLiveMode(): boolean {
  return config.isRealExternalServices || config.isProduction;
}

function toDuplicateResult(tx: any, platformBillId: string): PaymentFulfilmentResult {
  return {
    isDuplicate: true,
    internalTxnId: tx.internalTxnId,
    refID: tx.refID,
    platformBillId: tx.platformBillId || platformBillId,
    billerId: tx.billerId,
    billerName: tx.billerName,
    amount: typeof tx.amount === "number" ? tx.amount : parseFloat(tx.amount.toString()),
    paymentMode: tx.paymentInstrument || tx.paymentMode || "UPI",
    status: tx.status,
    bbpsRefNo: tx.bbpsRefNo,
    receiptNumber: tx.receiptNumber,
    receiptDate:
      tx.receiptDate instanceof Date ? tx.receiptDate.toISOString() : tx.receiptDate ?? null,
    rawPayload: tx.rawPayload,
  };
}

/**
 * Executes bill payment fulfilment via Setu BBPS API.
 * Endpoint: POST /utilities/bills/{platformBillId}/fulfilment
 *
 * Safety rules:
 *   - In live mode (real Setu or production) the customer must have paid Cikka first: a verified,
 *     captured Razorpay payment for exactly the requested amount is required.
 *   - A transaction is only ever marked SUCCESS when Setu explicitly says so. Network errors and
 *     5xx responses become RECONCILIATION_REQUIRED; missing statuses become PENDING.
 *   - Rewards are credited only on SUCCESS, with idempotent ledger keys.
 */
export async function payBillService(input: InitiatePaymentInput): Promise<PaymentFulfilmentResult> {
  const { platformBillId, paymentMode = "UPI", idempotencyKey } = input;
  const userId = input.userId || null;
  const live = isLiveMode();

  if (!platformBillId) {
    throw new BbpsPaymentError("platformBillId is required for payment fulfilment.");
  }
  if (config.isProduction && !config.isRealExternalServices) {
    throw new BbpsPaymentError("Bill payments are unavailable: external services are in stub mode.", 503);
  }

  // 1. Idempotency key — scoped per user. A Razorpay payment can fund exactly one fulfilment.
  const dedupKey = input.razorpayPaymentId
    ? `RZP:${input.razorpayPaymentId}`
    : idempotencyKey
      ? `${userId ?? "anon"}:${idempotencyKey}`
      : `IDEMP-${userId ?? "anon"}-${platformBillId}`;

  if (!live) {
    const inMemExisting =
      inMemoryTransactions.get(dedupKey) ||
      Array.from(inMemoryTransactions.values()).find(
        (t) => t.platformBillId === platformBillId && t.status === "SUCCESS" && (t.userId ?? null) === userId
      );
    if (inMemExisting) {
      return toDuplicateResult(inMemExisting, platformBillId);
    }
  }

  try {
    const existingTx = await prisma.bbpsTransaction.findFirst({
      where: {
        OR: [{ idempotencyKey: dedupKey }, { platformBillId, status: "SUCCESS" }],
      },
    });

    if (existingTx) {
      if ((existingTx.userId ?? null) !== userId) {
        throw new BbpsPaymentError("This bill has already been paid.", 409);
      }
      return toDuplicateResult(existingTx, platformBillId);
    }
  } catch (e) {
    if (e instanceof BbpsPaymentError) throw e;
    if (live) throw e;
  }

  // 2. Bill verification
  const bill = await getBillDetailsService(platformBillId);
  if (live) {
    if (!bill) throw new BbpsPaymentError("Bill not found or expired. Please fetch the bill again.", 404);
    if (bill.status === "PAID") throw new BbpsPaymentError("This bill has already been paid.", 409);
    if (bill.status === "EXPIRED") throw new BbpsPaymentError("This bill has expired. Please fetch it again.", 410);
  }

  const payableAmount = Number(input.amount) || bill?.amount || 0;
  if (!(payableAmount > 0)) {
    throw new BbpsPaymentError("A positive payment amount is required.");
  }
  const amountPaise = Math.round(payableAmount * 100);

  const billerId = bill?.billerId || input.billerId;
  if (!billerId) {
    throw new BbpsPaymentError("billerId is required.");
  }
  if (bill?.billerId && input.billerId && input.billerId !== bill.billerId) {
    throw new BbpsPaymentError("billerId does not match the fetched bill.");
  }
  const biller = await getBillerDetailsService(billerId);
  const billerName = bill?.billerName || biller?.billerName || "BBPS Utility";

  // 3. Customer must have paid Cikka before Cikka pays the biller
  if (live) {
    if (!input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) {
      throw new BbpsPaymentError("Payment confirmation is required before the bill can be paid.", 402);
    }
    const verification = await razorpayService.verifyCapturedPayment({
      razorpay_order_id: input.razorpayOrderId,
      razorpay_payment_id: input.razorpayPaymentId,
      razorpay_signature: input.razorpaySignature,
      expectedAmountPaise: amountPaise,
    });
    if (!verification.ok) {
      throw new BbpsPaymentError(`Payment could not be verified: ${verification.reason}`, 402);
    }
  }

  // 4. Unique internal transaction ID & refID
  const timestamp = Date.now();
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const internalTxnId = `CKK-BBPS-${timestamp}-${randomSuffix}`;
  const refID = `SETU-TXN-${timestamp}-${randomSuffix}`;

  // 5. Record the transaction BEFORE the external call. In live mode, no record → no payment.
  try {
    await prisma.bbpsTransaction.create({
      data: {
        internalTxnId,
        refID,
        platformBillId,
        userId,
        billerId,
        billerName,
        category: biller?.category || "Utilities",
        amount: payableAmount,
        customerParams: input.customerParams
          ? (input.customerParams as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        paymentInstrument: paymentMode,
        status: "PAYMENT_PROCESSING",
        idempotencyKey: dedupKey,
        rawPayload: {
          initiatedAt: new Date().toISOString(),
          razorpayOrderId: input.razorpayOrderId ?? null,
          razorpayPaymentId: input.razorpayPaymentId ?? null,
        },
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      throw new BbpsPaymentError("A payment for this request is already in progress.", 409);
    }
    if (live) throw e;
  }

  // 6. Fulfilment
  let fulfilmentStatus: "SUCCESS" | "PENDING" | "FAILED" | "RECONCILIATION_REQUIRED";
  let bbpsRefNo: string | null = null;
  let receiptNumber: string | null = null;
  const receiptDate: Date = new Date();
  let setuPaymentId: string | null = null;
  let rawResponse: any = null;

  if (!live) {
    // Stub mode: no external call, simulated success for local dev / tests.
    fulfilmentStatus = "SUCCESS";
    bbpsRefNo = `BBPS${timestamp.toString().slice(-8)}${randomSuffix}`;
    receiptNumber = `RCT-${timestamp.toString().slice(-6)}-${randomSuffix}`;
    rawResponse = { note: "Stub mode — fulfilment simulated, no external call made" };
  } else {
    try {
      const headers = await getSetuHeaders();
      const url = `${config.setuBaseUrl.replace(/\/+$/, "")}/utilities/bills/${encodeURIComponent(platformBillId)}/fulfilment`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          transactionId: internalTxnId,
          paymentDetails: {
            paymentInstrument: paymentMode,
            paymentMode: paymentMode,
            amount: { value: amountPaise, currency: "INR" },
          },
        }),
      });

      const data: any = await response.json().catch(() => ({}));
      rawResponse = data;

      if (response.ok) {
        const respStatus = String(data.status || data.data?.status || "").toUpperCase();
        if (respStatus === "SUCCESS" || respStatus === "PAID") {
          fulfilmentStatus = "SUCCESS";
        } else if (respStatus === "FAILED" || respStatus === "FAILURE" || respStatus === "REJECTED") {
          fulfilmentStatus = "FAILED";
        } else {
          // PENDING / PROCESSING / missing → wait for confirmation
          fulfilmentStatus = "PENDING";
        }

        setuPaymentId = data.id || data.data?.id || data.paymentId || null;
        bbpsRefNo = data.bbpsRefNo || data.data?.bbpsRefNo || null;
        receiptNumber = data.receiptNumber || data.data?.receiptNumber || null;
      } else if (response.status >= 500) {
        fulfilmentStatus = "RECONCILIATION_REQUIRED";
      } else {
        fulfilmentStatus = "FAILED";
      }
    } catch (err: any) {
      // Outcome unknown — never assume success.
      console.warn(`[SetuPayment Exception] ${err.message}. Marking transaction for reconciliation.`);
      fulfilmentStatus = "RECONCILIATION_REQUIRED";
      rawResponse = { error: err.message };
    }
  }

  // 7. Persist final state
  try {
    await prisma.bbpsTransaction.update({
      where: { internalTxnId },
      data: {
        status: fulfilmentStatus,
        bbpsRefNo,
        receiptNumber: fulfilmentStatus === "SUCCESS" ? receiptNumber : null,
        receiptDate: fulfilmentStatus === "SUCCESS" ? receiptDate : null,
        setuPaymentId,
        rawPayload: {
          response: rawResponse,
          razorpayOrderId: input.razorpayOrderId ?? null,
          razorpayPaymentId: input.razorpayPaymentId ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (e: any) {
    console.error(`[SetuPayment] Failed to persist final state for ${internalTxnId}: ${e?.message}`);
  }

  // 8. Definitive failure after the customer paid → refund the customer
  if (live && fulfilmentStatus === "FAILED" && input.razorpayPaymentId) {
    const refund = await razorpayService.refundPayment(input.razorpayPaymentId, amountPaise, {
      reason: "BBPS fulfilment failed",
      internalTxnId,
    });
    if (!refund.success) {
      console.error(`[SetuPayment] Refund failed for ${internalTxnId}: ${refund.error || refund.message}`);
    }
  }

  // 9. Mark bill paid
  if (fulfilmentStatus === "SUCCESS") {
    try {
      await prisma.bbpsBill.updateMany({ where: { platformBillId }, data: { status: "PAID" } });
    } catch (_e) {}
  }

  // 10. Unified financial ledger
  try {
    await prisma.paymentTransaction.create({
      data: {
        uniquePaymentRefID: refID,
        userId,
        amount: payableAmount,
        status: fulfilmentStatus,
        rawPayload: { type: "BBPS", billerId, internalTxnId, bbpsRefNo, receiptNumber },
      },
    });
  } catch (_e) {}

  // 11. Rewards — same calculation and ledger types as the BillPay webhook path
  let rewardsSummary: { cashbackEarned: number; ciPointsEarned: number } | undefined;

  if (fulfilmentStatus === "SUCCESS" && userId) {
    try {
      const rewards = RewardsCalcService.calculateCikkaPayRewards(internalTxnId, payableAmount);
      rewardsSummary = {
        cashbackEarned: rewards.cashbackEarned,
        ciPointsEarned: rewards.ciPointsEarned,
      };

      if (rewards.ciPointsEarned > 0) {
        await walletService.creditPoints(userId, rewards.ciPointsEarned, WalletTxType.EARN_BBPS, {
          idempotencyKey: `EARN_BBPS_PTS:${internalTxnId}`,
          description: `CI Points for bill payment to ${billerName}`,
        });
      }

      if (rewards.cashbackEarned > 0) {
        await walletService.creditCash(userId, Math.round(rewards.cashbackEarned * 100), WalletTxType.EARN_CASHBACK, {
          idempotencyKey: `EARN_BBPS_CASH:${internalTxnId}`,
          description: `₹${rewards.cashbackEarned} Cashback for bill payment to ${billerName}`,
        });
      }
    } catch (rewardErr: any) {
      console.warn(`[SetuPayment Rewards Warning] Failed to credit rewards: ${rewardErr.message}`);
    }
  }

  const finalResult: PaymentFulfilmentResult = {
    isDuplicate: false,
    internalTxnId,
    refID,
    platformBillId,
    billerId,
    billerName,
    amount: payableAmount,
    paymentMode,
    status: fulfilmentStatus,
    bbpsRefNo,
    receiptNumber: fulfilmentStatus === "SUCCESS" ? receiptNumber : null,
    receiptDate: fulfilmentStatus === "SUCCESS" ? receiptDate.toISOString() : null,
    rewards: rewardsSummary,
    rawPayload: rawResponse,
  };

  if (!live) {
    const memRecord = { ...finalResult, idempotencyKey: dedupKey, userId };
    rememberInMemory(internalTxnId, memRecord);
    rememberInMemory(dedupKey, memRecord);
  }

  return finalResult;
}
