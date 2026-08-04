import { asyncHandler } from "../utils/asyncHandler";
import * as dashboardService from "../services/dashboard.service";

export const getSummary = asyncHandler(async (req, res) => {
  if (!req.seller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const summary = await dashboardService.getSummary(req.seller.id);
  res.json(summary);
});

export const getSettlementBreakdown = asyncHandler(async (req, res) => {
  if (!req.seller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const period = req.query.period === "month" ? "month" : "week";
  const breakdown = await dashboardService.getSettlementBreakdown(req.seller.id, period);
  res.json(breakdown);
});

