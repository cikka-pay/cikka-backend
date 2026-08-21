import { prisma } from "../config/prisma";
import { setuBbpsService } from "../external/setu/setu-bbps.client";
import { BBPS_ERRORS } from "../constants/errors";
import { setuClient } from "../external";

export async function getBbpsCategoriesService() {
  return setuClient.getBillerCategories();
}

export async function getBbpsBillersService(category?: string, query?: string) {
  // 1. Check local DB cache for billers
  try {
    const whereClause: any = { isActive: true };
    if (category) whereClause.category = category.toUpperCase();
    if (query) {
      whereClause.OR = [
        { billerName: { contains: query, mode: "insensitive" } },
        { billerId: { contains: query, mode: "insensitive" } },
      ];
    }

    const dbBillers = await (prisma as any).bbpsBiller?.findMany({ where: whereClause });
    if (dbBillers && dbBillers.length > 0) {
      return dbBillers;
    }
  } catch (err: any) {
    console.warn(`[BBPS DB Warning] Biller lookup DB query skipped/failed: ${err.message}`);
  }

  // 2. Fall back to Setu Client
  return setuClient.getBillers(category, query);
}

export async function getBillerDetailsService(billerId: string) {
  return await setuBbpsService.getBillerDetails(billerId);
}

export interface FetchBillDTO {
  userId?: string;
  billerId: string;
  customerParams: Record<string, any>;
}

export async function fetchBillService(dto: FetchBillDTO) {
  return await setuBbpsService.fetchBill(dto);
}

export interface InitiateBbpsPaymentDTO {
  billerId: string;
  billerName: string;
  category: string;
  amount: number;
  customerParams: Record<string, any>;
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
      rawPayload: paymentResult,
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

export interface CreatePaymentOrderDTO {
  userId: string;
  billerId: string;
  billFetchId?: string;
  amount: number;
  paymentMode?: string;
}

export async function fetchBbpsBillService(dto: FetchBillDTO) {
  const { userId, billerId, customerParams } = dto;

  if (!billerId) throw new Error(BBPS_ERRORS.BILLER_ID_REQUIRED);
  if (!customerParams || Object.keys(customerParams).length === 0) {
    throw new Error(BBPS_ERRORS.CUSTOMER_PARAMS_REQUIRED);
  }

  // Fetch bill from Setu BBPS Gateway
  const billResult = await setuClient.fetchBill(billerId, customerParams);

  // Record bill fetch in DB for audit trail
  let dbRecord = null;
  try {
    if ((prisma as any).bbpsBillFetch) {
      dbRecord = await (prisma as any).bbpsBillFetch.create({
        data: {
          userId: userId || "guest_user",
          billerId,
          customerParams,
          billNumber: billResult.billNumber,
          billAmount: billResult.billAmount,
          dueDate: billResult.dueDate ? new Date(billResult.dueDate) : null,
          customerName: billResult.customerName,
          status: "FETCHED",
        },
      });
    }
  } catch (err: any) {
    console.warn(`[BBPS DB Warning] Bill fetch DB logging skipped: ${err.message}`);
  }

  return {
    billFetchId: dbRecord?.id || `fetch_${Date.now()}`,
    billerId: billResult.billerId,
    customerParams: billResult.customerParams,
    billNumber: billResult.billNumber,
    billAmount: billResult.billAmount,
    dueDate: billResult.dueDate,
    customerName: billResult.customerName,
  };
}

export async function createBbpsPaymentOrderService(dto: CreatePaymentOrderDTO) {
  const { userId, billerId, billFetchId, amount, paymentMode } = dto;

  if (!billerId) throw new Error(BBPS_ERRORS.BILLER_ID_REQUIRED);
  if (!amount || amount <= 0) throw new Error(BBPS_ERRORS.INVALID_PAYMENT_AMOUNT);

  // Call Setu Custom Payment Order API
  const orderResult = await setuClient.createPaymentOrder({
    billerId,
    amount,
    userId,
    billFetchId,
  });

  // Record payment intent in DB
  let paymentRecord = null;
  try {
    if ((prisma as any).bbpsBillPayment) {
      paymentRecord = await (prisma as any).bbpsBillPayment.create({
        data: {
          userId,
          billerId,
          billFetchId: billFetchId || null,
          amount,
          paymentMode: paymentMode || "UPI",
          uniquePaymentRefID: orderResult.uniquePaymentRefID,
          setuPaymentLink: orderResult.setuPaymentLink,
          setuQrCode: orderResult.setuQrCode || null,
          status: orderResult.status || "INITIATED",
        },
      });
    }
  } catch (err: any) {
    console.warn(`[BBPS DB Warning] Bill payment order DB logging skipped: ${err.message}`);
  }

  return {
    paymentId: paymentRecord?.id || `pay_${Date.now()}`,
    uniquePaymentRefID: orderResult.uniquePaymentRefID,
    billerId,
    amount,
    setuPaymentLink: orderResult.setuPaymentLink,
    setuQrCode: orderResult.setuQrCode,
    status: orderResult.status,
  };
}
