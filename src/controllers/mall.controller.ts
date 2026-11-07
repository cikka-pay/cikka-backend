import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { parsePricingRequest, priceCart, toQuoteResponse, PricingError } from "../services/mallPricing.service";

/**
 * POST /api/mall/quote  (user JWT optional; needed for cashback and exchanges)
 * Server-computed cart breakdown (spec 003 §2). Same pricing function as create-order.
 */
export const quoteMallCart = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  try {
    const cart = await priceCart(parsePricingRequest(req.body), userId);
    res.status(200).json({ success: true, ...toQuoteResponse(cart, userId) });
  } catch (err) {
    if (err instanceof PricingError) {
      res.status(err.status).json({ success: false, error: err.message, code: err.code, ...(err.details || {}) });
      return;
    }
    throw err;
  }
});
