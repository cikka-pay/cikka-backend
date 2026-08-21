import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getBbpsCategoriesService,
  getBbpsBillersService,
  getBillerDetailsService,
  fetchBillService,
  fetchBbpsBillService,
  initiateBbpsPaymentService,
  createBbpsPaymentOrderService,
  getUserBbpsHistoryService,
} from "../services/bbps.service";
import { checkPaymentStatusService } from "../services/setu.service";

/**
 * GET /api/bbps/categories
 */
export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await getBbpsCategoriesService();
  res.status(200).json({ success: true, categories });
});

/**
 * GET /api/bbps/billers
 */
export const getBillers = asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const query = req.query.query as string | undefined;
  const billers = await getBbpsBillersService(category, query);
  res.status(200).json({ success: true, billers });
});

/**
 * GET /api/bbps/billers/:billerId
 */
export const getBillerDetails = asyncHandler(async (req: Request, res: Response) => {
  const { billerId } = req.params;
  const biller = await getBillerDetailsService(billerId);
  res.status(200).json({ success: true, biller });
});

/**
 * POST /api/bbps/fetch-bill or /bills/fetch
 */
export const fetchBill = asyncHandler(async (req: Request, res: Response) => {
  const { billerId, customerParams } = req.body;

  const billDetails = await fetchBillService({ billerId, customerParams });
  const bill = {
    billFetchId: `fetch_${Date.now()}`,
    billerId: billDetails.billerId,
    customerParams: billDetails.customerParams,
    billNumber: billDetails.setuBillId || `BILL-${Date.now()}`,
    billAmount: billDetails.billAmount,
    dueDate: billDetails.dueDate,
    customerName: billDetails.customerName,
  };

  res.status(200).json({
    success: true,
    message: "Bill details fetched successfully",
    bill,
    billDetails,
  });
});

/**
 * POST /api/bbps/payments/initiate
 */
export const initiateBbpsPayment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.sub || null;
  const result = await initiateBbpsPaymentService(userId, req.body);
  res.status(201).json({
    success: true,
    message: "BBPS Payment processed successfully",
    payment: result,
  });
});

/**
 * POST /api/bbps/create-payment-order
 */
export const createPaymentOrder = asyncHandler(async (req: Request, res: Response) => {
  const { billerId, billFetchId, amount, paymentMode } = req.body;
  const userId = req.user?.sub || req.user?.id || req.seller?.id || "guest_user";

  const order = await createBbpsPaymentOrderService({
    userId,
    billerId,
    billFetchId,
    amount: parseFloat(amount.toString()),
    paymentMode,
  });

  res.status(200).json({
    success: true,
    message: "BBPS payment order created successfully",
    order,
  });
});

/**
 * GET /api/bbps/payments/:refID/status
 */
export const getPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { refID } = req.params;
  const result = await checkPaymentStatusService({ refID });
  res.status(200).json({ success: true, transaction: result });
});

/**
 * GET /api/bbps/history
 */
export const getBbpsHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const history = await getUserBbpsHistoryService(userId);
  res.status(200).json({ success: true, history });
});
