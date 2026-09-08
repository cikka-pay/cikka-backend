import { Prisma } from "@prisma/client";
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
  const existingTx = await prisma.bbpsTransaction.findUnique({
    where: { refID },
  });

  if (existingTx) {
    return {
      isDuplicate: true,
      refID: existingTx.refID,
      status: existingTx.status,
      amount: parseFloat(existingTx.amount.toString()),
      bbpsRefNo: existingTx.bbpsRefNo,
      setuPaymentId: existingTx.setuPaymentId,
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
      refID,
      userId: userId || null,
      billerId: dto.billerId,
      billerName: dto.billerName,
      category: dto.category,
      customerParams: dto.customerParams,
      amount: dto.amount,
      status: paymentResult.status,
      setuBillId: dto.setuBillId || null,
      setuPaymentId: paymentResult.setuPaymentId || null,
      bbpsRefNo: paymentResult.bbpsRefNo || null,
      rawPayload: paymentResult as unknown as Prisma.InputJsonValue,
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
    refID: bbpsTx.refID,
    status: bbpsTx.status,
    amount: parseFloat(bbpsTx.amount.toString()),
    billerName: bbpsTx.billerName,
    setuPaymentId: bbpsTx.setuPaymentId,
    bbpsRefNo: bbpsTx.bbpsRefNo,
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
    refID: tx.refID,
    billerId: tx.billerId,
    billerName: tx.billerName,
    category: tx.category,
    amount: parseFloat(tx.amount.toString()),
    status: tx.status,
    bbpsRefNo: tx.bbpsRefNo,
    createdAt: tx.createdAt,
  }));
}
