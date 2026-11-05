import { Prisma, BbpsTxnStatus } from "../generated/prisma/client";
import { prisma } from "../config/prisma";
import { setuBbpsService } from "../external/setu/setu-bbps.client";
import { BBPS_ERRORS } from "../constants/errors";

export async function getBbpsCategoriesService() {
  return await setuBbpsService.getCategories();
}

export async function getBbpsBillersService(category?: string) {
  return await setuBbpsService.getBillers(category);
}

export async function getBillerDetailsService(billerId: string) {
  return await setuBbpsService.getBillerDetails(billerId);
}

export interface FetchBillDTO {
  billerId: string;
  customerParams: Record<string, string>;
}

export async function fetchBillService(dto: FetchBillDTO) {
  return await setuBbpsService.fetchBill(dto);
}

export interface InitiateBbpsPaymentDTO {
  billerId: string;
  billerName: string;
  category: string;
  amount: number;
  customerParams: Record<string, string>;
  setuBillId?: string;
  refID?: string;
}

export async function initiateBbpsPaymentService(userId: string | null, dto: InitiateBbpsPaymentDTO) {
  const refID = dto.refID || `CKK-BBPS-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // 1. Check idempotency in BBPS ledger
  // NOTE (spec 002): legacy direct-pay flow, kept compiling against the reshaped
  // BbpsTransaction model only until it is retired (implementation-plan step 7).
  const existingTx = await prisma.bbpsTransaction.findFirst({
    where: { refId: refID },
  });

  if (existingTx) {
    return {
      isDuplicate: true,
      refID: existingTx.refId,
      status: existingTx.status,
      amount: existingTx.amountPaid ? parseFloat(existingTx.amountPaid.toString()) : 0,
      bbpsRefNo: existingTx.bbpsTxnId,
      setuPaymentId: existingTx.setuOrderId,
    };
  }

  // 2. Call Setu BBPS gateway to execute payment
  const paymentResult = await setuBbpsService.payBill({
    refID,
    billerId: dto.billerId,
    amount: dto.amount,
    customerParams: dto.customerParams,
    setuBillId: dto.setuBillId,
  });

  // 3. Persist record in BbpsTransaction database
  const bbpsTx = await prisma.bbpsTransaction.create({
    data: {
      refId: refID,
      userId: userId || null,
      billerId: dto.billerId,
      billerName: dto.billerName,
      category: dto.category,
      amountPaid: dto.amount,
      status: toBbpsTxnStatus(paymentResult.status),
      bbpsTxnId: paymentResult.bbpsRefNo || null,
      rawPayload: {
        ...(paymentResult as unknown as Record<string, unknown>),
        customerParams: dto.customerParams,
        setuBillId: dto.setuBillId || null,
      } as Prisma.InputJsonValue,
    },
  });

  // 4. Also record entry in main PaymentTransaction ledger
  await prisma.paymentTransaction.create({
    data: {
      uniquePaymentRefID: refID,
      userId: userId || null,
      amount: dto.amount,
      status: paymentResult.status,
      rawPayload: { type: "BBPS", billerId: dto.billerId, category: dto.category },
    },
  });

  return {
    isDuplicate: false,
    refID: bbpsTx.refId,
    status: bbpsTx.status,
    amount: dto.amount,
    billerName: bbpsTx.billerName,
    setuPaymentId: paymentResult.setuPaymentId || null,
    bbpsRefNo: bbpsTx.bbpsTxnId,
    receiptUrl: paymentResult.receiptUrl,
    createdAt: bbpsTx.createdAt,
  };
}

export async function getUserBbpsHistoryService(userId: string) {
  const transactions = await prisma.bbpsTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return transactions.map((tx) => ({
    id: tx.id,
    refID: tx.refId,
    billerId: tx.billerId,
    billerName: tx.billerName,
    category: tx.category,
    amount: tx.amountPaid ? parseFloat(tx.amountPaid.toString()) : 0,
    status: tx.status,
    bbpsRefNo: tx.bbpsTxnId,
    createdAt: tx.createdAt,
  }));
}

/** Legacy-flow shim: map a free-text gateway status onto the BbpsTxnStatus enum. */
export function toBbpsTxnStatus(status: string | undefined | null): BbpsTxnStatus {
  switch ((status || "").toUpperCase()) {
    case "SUCCESS":
      return "SUCCESS";
    case "FAILED":
    case "FAILURE":
      return "FAILED";
    case "REFUNDED":
      return "REFUNDED";
    default:
      return "PENDING";
  }
}
