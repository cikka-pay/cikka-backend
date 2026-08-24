import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { verifyPanService } from "../services/instantpay.service";

/**
 * POST /api/kyc/verify-pan
 * POST /api/instantpay/verify-pan
 * Perform PAN authentication and identity verification via InstantPay.
 */
export const verifyPan = asyncHandler(async (req: Request, res: Response) => {
  const { pan } = req.body;
  const userId = req.user?.id || req.seller?.id || "guest_user";

  const result = await verifyPanService({ userId, pan });

  res.status(200).json({
    success: true,
    message: result.valid ? "PAN verified successfully" : "PAN verification failed",
    data: result,
  });
});
