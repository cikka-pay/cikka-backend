import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import {
  setuBillerService,
  setuValidationService,
  setuBillService,
  setuPaymentService,
  setuReceiptService,
  setuSettlementService,
} from "../services/setu";
import { BbpsPaymentError } from "../services/setu/setuPayment.service";

export const getBillers = asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;

  const billers = await setuBillerService.getBillersService({ category, search });
  res.status(200).json({
    success: true,
    count: billers.length,
    billers,
  });
});

export const getBillerDetails = asyncHandler(async (req: Request, res: Response) => {
  const { billerId } = req.params;
  const biller = await setuBillerService.getBillerDetailsService(billerId);

  if (!biller) {
    res.status(404).json({
      success: false,
      error: `Biller ${billerId} not found.`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    biller,
  });
});

export const validateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { billerId, customerParams } = req.body;
  const result = await setuValidationService.validateCustomerService({
    billerId,
    customerParams,
  });

  res.status(200).json({
    success: result.isValid,
    validation: result,
  });
});

export const fetchBill = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || null;
  const { billerId, customerParams } = req.body;

  const billDetails = await setuBillService.fetchBillService({
    userId,
    billerId,
    customerParams,
  });

  res.status(200).json({
    success: true,
    bill: billDetails,
  });
});

export const getBillDetails = asyncHandler(async (req: Request, res: Response) => {
  const { platformBillId } = req.params;
  const bill = await setuBillService.getBillDetailsService(platformBillId);

  if (!bill) {
    res.status(404).json({
      success: false,
      error: `Bill with platformBillId ${platformBillId} not found or expired.`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    bill,
  });
});

export const payBill = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || null;
  const {
    platformBillId,
    amount,
    paymentMode,
    billerId,
    customerParams,
    idempotencyKey,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  let result;
  try {
    result = await setuPaymentService.payBillService({
      userId,
      platformBillId,
      amount: Number(amount),
      paymentMode: paymentMode || "UPI",
      billerId,
      customerParams,
      idempotencyKey,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });
  } catch (err) {
    if (err instanceof BbpsPaymentError) {
      res.status(err.httpStatus).json({ success: false, error: err.message });
      return;
    }
    throw err;
  }

  res.status(result.status === "FAILED" ? 400 : 200).json({
    success: result.status !== "FAILED",
    transaction: result,
  });
});

export const getTransactions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
  const skip = (page - 1) * limit;

  const category = req.query.category as string | undefined;
  const status = req.query.status as string | undefined;

  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const whereClause: any = { userId };
  if (category) {
    whereClause.category = { equals: category, mode: "insensitive" };
  }
  if (status) {
    whereClause.status = { equals: status.toUpperCase() };
  }

  const [total, txns] = await Promise.all([
    prisma.bbpsTransaction.count({ where: whereClause }),
    prisma.bbpsTransaction.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const formatted = txns.map((t) => ({
    id: t.id,
    internalTxnId: t.internalTxnId,
    refID: t.refID,
    platformBillId: t.platformBillId,
    billerId: t.billerId,
    billerName: t.billerName,
    category: t.category,
    amount: parseFloat(t.amount.toString()),
    paymentInstrument: t.paymentInstrument,
    status: t.status,
    bbpsRefNo: t.bbpsRefNo,
    receiptNumber: t.receiptNumber,
    receiptDate: t.receiptDate ? t.receiptDate.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  }));

  res.status(200).json({
    success: true,
    transactions: formatted,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    },
  });
});

export const getTransactionById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const tx = await prisma.bbpsTransaction.findFirst({
    where: {
      userId: req.user!.id,
      OR: [{ id }, { internalTxnId: id }, { refID: id }, { platformBillId: id }],
    },
  });

  if (!tx) {
    res.status(404).json({
      success: false,
      error: `Transaction ${id} not found.`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    transaction: {
      id: tx.id,
      internalTxnId: tx.internalTxnId,
      refID: tx.refID,
      platformBillId: tx.platformBillId,
      billerId: tx.billerId,
      billerName: tx.billerName,
      category: tx.category,
      amount: parseFloat(tx.amount.toString()),
      paymentInstrument: tx.paymentInstrument,
      status: tx.status,
      bbpsRefNo: tx.bbpsRefNo,
      receiptNumber: tx.receiptNumber,
      receiptDate: tx.receiptDate ? tx.receiptDate.toISOString() : null,
      createdAt: tx.createdAt.toISOString(),
    },
  });
});

export const getTransactionReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const receipt = await setuReceiptService.getTransactionReceiptService(id, req.user!.id);

  if (!receipt) {
    res.status(404).json({
      success: false,
      error: `Receipt for transaction ${id} not found or not yet generated.`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    receipt,
  });
});

export const getSettlements = asyncHandler(async (_req: Request, res: Response) => {
  const settlements = await setuSettlementService.getSettlementReportsService();
  res.status(200).json({
    success: true,
    count: settlements.length,
    settlements,
  });
});

export const reconcilePending = asyncHandler(async (_req: Request, res: Response) => {
  const result = await setuSettlementService.reconcileTransactionsService();
  res.status(200).json({
    success: true,
    message: `Reconciliation completed: ${result.reconciledCount} transactions updated.`,
    result,
  });
});
