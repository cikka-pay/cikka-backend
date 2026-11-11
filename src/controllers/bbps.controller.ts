import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getBbpsCategoriesService,
  getBbpsBillersService,
  getBillerDetailsService,
  fetchBillService,
  initiateBbpsPaymentService,
  getUserBbpsHistoryService,
  getUserBillpayHistoryItem,
} from "../services/bbps.service";
import { BillpaySessionError, createBillpaySessionService } from "../services/billpaySession.service";
import { checkPaymentStatusService } from "../services/setu.service";

export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await getBbpsCategoriesService();
  res.status(200).json({ success: true, categories });
});

export const getBillers = asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const billers = await getBbpsBillersService(category);
  res.status(200).json({ success: true, billers });
});

export const getBillerDetails = asyncHandler(async (req: Request, res: Response) => {
  const { billerId } = req.params;
  const biller = await getBillerDetailsService(billerId);
  res.status(200).json({ success: true, biller });
});

export const fetchBill = asyncHandler(async (req: Request, res: Response) => {
  const { billerId, customerParams } = req.body;
  const billDetails = await fetchBillService({ billerId, customerParams });
  res.status(200).json({ success: true, billDetails });
});

export const initiateBbpsPayment = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id || null;
  const result = await initiateBbpsPaymentService(userId, req.body);
  res.status(201).json({
    success: true,
    message: "BBPS Payment processed successfully",
    payment: result,
  });
});

export const getPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const { refID } = req.params;
  const result = await checkPaymentStatusService({ refID });
  res.status(200).json({ success: true, transaction: result });
});

export const getBbpsHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const history = await getUserBbpsHistoryService(userId);
  res.status(200).json({ success: true, history });
});

export const getBbpsHistoryItem = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const payment = idParam ? await getUserBillpayHistoryItem(userId, idParam) : null;
  if (!payment) {
    res.status(404).json({ success: false, error: "Payment record not found" });
    return;
  }
  res.status(200).json({ success: true, payment });
});

export const createBbpsSession = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }

  try {
    const result = await createBillpaySessionService({
      userId,
      categoryName: req.body?.categoryName,
      billerId: req.body?.billerId,
      redirectTo: req.body?.redirectTo,
      transactionRef: req.body?.transactionRef || req.body?.refId,
    });
    res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      link: result.link,
    });
  } catch (err) {
    if (err instanceof BillpaySessionError) {
      res.status(err.status).json({
        success: false,
        code: err.code,
        error: err.message,
      });
      return;
    }
    throw err;
  }
});
