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
  const rawPeriod = (req.query.period as string) || "this_week";
  let period: "this_week" | "last_week" | "this_month" = "this_week";
  if (rawPeriod === "last_week") {
    period = "last_week";
  } else if (rawPeriod === "this_month" || rawPeriod === "month") {
    period = "this_month";
  } else {
    period = "this_week";
  }
  const breakdown = await dashboardService.getSettlementBreakdown(req.seller.id, period, req.seller.role);
  res.json(breakdown);
});


