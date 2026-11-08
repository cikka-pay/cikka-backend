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
  // Accepts the documented week|month plus the this_week|last_week|this_month aliases, and
  // echoes the value the client sent; anything else falls back to this_week.
  const PERIODS = ["this_week", "last_week", "this_month", "week", "month"] as const;
  type Period = (typeof PERIODS)[number];
  const rawPeriod = req.query.period as string;
  const period: Period = (PERIODS as readonly string[]).includes(rawPeriod) ? (rawPeriod as Period) : "this_week";
  const breakdown = await dashboardService.getSettlementBreakdown(req.seller.id, period, req.seller.role);
  res.json(breakdown);
});


