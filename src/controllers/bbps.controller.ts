import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getBbpsCategoriesService,
  getBbpsBillersService,
  fetchBbpsBillService,
  createBbpsPaymentOrderService,
} from "../services/bbps.service";

/**
 * GET /api/bbps/categories
 * Retrieve all supported BBPS biller categories.
 */
export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await getBbpsCategoriesService();
  res.status(200).json({
    success: true,
    categories,
  });
});

/**
 * GET /api/bbps/billers
 * Retrieve billers filtered by category or search query.
 */
export const getBillers = asyncHandler(async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const query = req.query.query as string | undefined;

  const billers = await getBbpsBillersService(category, query);
  res.status(200).json({
    success: true,
    billers,
  });
});

/**
 * POST /api/bbps/fetch-bill
 * Fetch due bill details for a customer from Setu BBPS Gateway.
 */
export const fetchBill = asyncHandler(async (req: Request, res: Response) => {
  const { billerId, customerParams } = req.body;
  const userId = req.user?.id || req.seller?.id || "guest_user";

  const bill = await fetchBbpsBillService({
    userId,
    billerId,
    customerParams,
  });

  res.status(200).json({
    success: true,
    message: "Bill details fetched successfully",
    bill,
  });
});

/**
 * POST /api/bbps/create-payment-order
 * Create a Setu BBPS payment order & payment link / UPI QR.
 */
export const createPaymentOrder = asyncHandler(async (req: Request, res: Response) => {
  const { billerId, billFetchId, amount, paymentMode } = req.body;
  const userId = req.user?.id || req.seller?.id || "guest_user";

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
