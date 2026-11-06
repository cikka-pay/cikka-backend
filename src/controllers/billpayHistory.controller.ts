import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { getBillpayHistoryItem, listBillpayHistory } from "../services/billpayHistory.service";

// GET /api/bbps/history — last 50 bill payments of the caller
export const getBillpayHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const history = await listBillpayHistory(userId);
  res.status(200).json({ success: true, history });
});

// GET /api/bbps/history/:id — one bill payment; 404 if it isn't the caller's
export const getBillpayHistoryById = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const item = await getBillpayHistoryItem(userId, String(req.params.id));
  if (!item) {
    res.status(404).json({ success: false, error: "Bill payment not found" });
    return;
  }
  res.status(200).json({ success: true, payment: item });
});
