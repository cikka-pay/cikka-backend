import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { verifyPanService, verifyGstinService, verifyCinService } from "../services/instantpay.service";

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

/**
 * POST /api/kyc/verify-gstin
 * POST /api/instantpay/verify-gstin
 * Perform GSTIN verification & fetch company details via InstantPay.
 */
export const verifyGstin = asyncHandler(async (req: Request, res: Response) => {
  const { gstNumber, externalRef, latitude, longitude } = req.body;
  const sellerId = req.seller?.id || "guest_seller";
  const userId = req.user?.id || "guest_user";

  const result = await verifyGstinService({
    sellerId,
    userId,
    gstNumber,
    externalRef,
    latitude,
    longitude,
  });

  res.status(200).json({
    success: true,
    message: result.valid ? "GSTIN verified successfully" : "GSTIN verification failed",
    data: result,
  });
});

/**
 * POST /api/kyc/verify-cin
 * POST /api/instantpay/verify-cin
 * Perform CIN lookup via InstantPay fetchCIN API.
 */
export const verifyCin = asyncHandler(async (req: Request, res: Response) => {
  const { cin, externalRef, latitude, longitude } = req.body;
  const sellerId = req.seller?.id || "guest_seller";
  const userId = req.user?.id || "guest_user";

  const result = await verifyCinService({
    sellerId,
    userId,
    cin,
    externalRef,
    latitude,
    longitude,
  });

  res.status(200).json({
    success: true,
    message: result.valid ? "CIN verified successfully" : "CIN verification failed",
    data: result,
  });
});
