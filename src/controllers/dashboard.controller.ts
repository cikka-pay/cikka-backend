import { asyncHandler } from "../utils/asyncHandler";
import { AUTH_ERRORS } from "../constants/errors";
import * as dashboardService from "../services/dashboard.service";

export const getSummary = asyncHandler(async (req, res) => {
  if (!req.seller) {
    res.status(401).json({ error: AUTH_ERRORS.UNAUTHORIZED });
    return;
  }
  const summary = await dashboardService.getSummary(req.seller.id, req.seller.role);
  res.json(summary);
});

export const getSettlementBreakdown = asyncHandler(async (req, res) => {
  if (!req.seller) {
    res.status(401).json({ error: AUTH_ERRORS.UNAUTHORIZED });
    return;
  }
  const period = req.query.period === "month" ? "month" : "week";
  const breakdown = await dashboardService.getSettlementBreakdown(req.seller.id, period, req.seller.role);
  res.json(breakdown);
});


