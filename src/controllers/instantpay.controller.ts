import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import {
  verifyAadhaarService,
  verifyBankAccountService,
  verifyCinService,
  verifyGstinService,
  verifyPanService,
  verifyVpaService,
} from "../services/instantpay.service";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * POST /api/kyc/verify-pan
 * POST /api/instantpay/verify-pan
 * Perform PAN authentication and identity verification via InstantPay.
 */
export const verifyPan = asyncHandler(async (req: Request, res: Response) => {
  const { pan } = req.body;
  const sellerId = req.seller?.id;
  const userId = req.user?.id || sellerId;

  const result = await verifyPanService({ userId, pan });

  if (!result.valid) {
    const errorMsg =
      result.status === "INSUFFICIENT_BALANCE"
        ? "InstantPay Service balance low. Please try again later."
        : `PAN Verification Failed: ${result.status || "Invalid PAN Card Number"}`;

    res.status(400).json({
      success: false,
      message: errorMsg,
      error: errorMsg,
      data: result,
    });
    return;
  }

  // Sync verified PAN to SellerOnboarding if seller is authenticated
  if (sellerId) {
    await prisma.sellerOnboarding.upsert({
      where: { sellerId },
      update: {
        panNumber: result.pan,
        panVerified: true,
        panData: result as any,
      },
      create: {
        sellerId,
        panNumber: result.pan,
        panVerified: true,
        panData: result as any,
      },
    }).catch((err) => console.warn(`[InstantPay Onboarding Sync] PAN sync skipped: ${err.message}`));
  }

  res.status(200).json({
    success: true,
    message: result.isDevBypass ? "⚡ PAN verified via Dev Bypass" : "PAN verified successfully",
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
  const sellerId = req.seller?.id;
  const userId = req.user?.id;

  const result = await verifyGstinService({
    sellerId,
    userId,
    gstNumber,
    externalRef,
    latitude,
    longitude,
  });

  const failureMessage =
    result.error ||
    (result.status && result.status !== "Active" ? `GSTIN verification failed: ${result.status}` : "GSTIN verification failed");

  // Sync verified GSTIN to SellerOnboarding if seller is authenticated
  if (result.valid && sellerId) {
    await prisma.sellerOnboarding.upsert({
      where: { sellerId },
      update: {
        gstNumber: result.gstin,
        gstVerified: true,
        gstData: result as any,
      },
      create: {
        sellerId,
        gstNumber: result.gstin,
        gstVerified: true,
        gstData: result as any,
      },
    }).catch((err) => console.warn(`[InstantPay Onboarding Sync] GSTIN sync skipped: ${err.message}`));
  }

  res.status(200).json({
    success: result.valid,
    message: result.valid ? "GSTIN verified successfully" : failureMessage,
    error: result.valid ? undefined : failureMessage,
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
  const sellerId = req.seller?.id;
  const userId = req.user?.id;

  const result = await verifyCinService({
    sellerId,
    userId,
    cin,
    externalRef,
    latitude,
    longitude,
  });

  // Sync verified CIN to SellerOnboarding if seller is authenticated
  if (result.valid && sellerId) {
    await prisma.sellerOnboarding.upsert({
      where: { sellerId },
      update: {
        cinNumber: result.cin,
        cinVerified: true,
        cinData: result as any,
      },
      create: {
        sellerId,
        cinNumber: result.cin,
        cinVerified: true,
        cinData: result as any,
      },
    }).catch((err) => console.warn(`[InstantPay Onboarding Sync] CIN sync skipped: ${err.message}`));
  }

  res.status(200).json({
    success: true,
    message: result.valid ? "CIN verification completed" : "CIN verification failed",
    data: result,
  });
});

/**
 * POST /api/kyc/verify-aadhaar
 * POST /api/instantpay/verify-aadhaar
 * Perform Aadhaar Demographic verification via InstantPay API.
 */
export const verifyAadhaar = asyncHandler(async (req: Request, res: Response) => {
  const { aadhaarNumber, name, externalRef, latitude, longitude } = req.body;
  const sellerId = req.seller?.id;
  const userId = req.user?.id;

  const result = await verifyAadhaarService({
    sellerId,
    userId,
    aadhaarNumber,
    name,
    externalRef,
    latitude,
    longitude,
  });

  const failureMessage =
    result.error ||
    (result.status && result.status !== "VALID" ? `Aadhaar verification failed: ${result.status}` : "Aadhaar verification failed");

  // Sync verified Aadhaar to SellerOnboarding if seller is authenticated
  if (result.valid && sellerId) {
    const verifiedName = result.aadhaarHolderName || name || undefined;
    await prisma.sellerOnboarding.upsert({
      where: { sellerId },
      update: {
        signatoryAadhaar: result.aadhaarNumber || aadhaarNumber,
        signatoryAadhaarVerified: true,
        ...(verifiedName ? { signatoryName: verifiedName } : {}),
      },
      create: {
        sellerId,
        signatoryAadhaar: result.aadhaarNumber || aadhaarNumber,
        signatoryAadhaarVerified: true,
        signatoryName: verifiedName,
      },
    }).catch((err) => console.warn(`[InstantPay Onboarding Sync] Aadhaar sync skipped: ${err.message}`));
  }

  res.status(200).json({
    success: result.valid,
    message: result.valid ? "Aadhaar verified successfully" : failureMessage,
    error: result.valid ? undefined : failureMessage,
    data: result,
  });
});

/**
 * POST /api/kyc/verify-vpa
 * POST /api/instantpay/verify-vpa
 * Perform UPI VPA / Handle verification via InstantPay verifyBankAccount API.
 */
export const verifyVpa = asyncHandler(async (req: Request, res: Response) => {
  const { vpa, name, bankIfsc, externalRef, latitude, longitude } = req.body;
  const sellerId = req.seller?.id;
  const userId = req.user?.id;

  const result = await verifyVpaService({
    sellerId,
    userId,
    vpa,
    name,
    bankIfsc,
    externalRef,
    latitude,
    longitude,
  });

  res.status(200).json({
    success: true,
    message: result.valid ? "UPI VPA verified successfully" : "UPI VPA verification failed",
    data: result,
  });
});

/**
 * POST /api/kyc/verify-bank-account
 * POST /api/instantpay/verify-bank-account
 * Perform Bank Account Penny Drop verification via InstantPay verifyBankAccount API.
 */
export const verifyBankAccount = asyncHandler(async (req: Request, res: Response) => {
  const { accountNumber, bankIfsc, name, bankName, externalRef, latitude, longitude } = req.body;
  const sellerId = req.seller?.id;
  const userId = req.user?.id;

  const result = await verifyBankAccountService({
    sellerId,
    userId,
    accountNumber,
    bankIfsc,
    name,
    externalRef,
    latitude,
    longitude,
  });

  // Sync verified Bank details to SellerOnboarding if seller is authenticated
  if (result.valid && sellerId) {
    const verifiedHolder = result.accountHolderName || name || undefined;
    await prisma.sellerOnboarding.upsert({
      where: { sellerId },
      update: {
        bankAccountNumber: accountNumber,
        bankIfsc: bankIfsc,
        bankVerified: true,
        ...(bankName ? { bankName } : {}),
        ...(verifiedHolder ? { bankAccountHolder: verifiedHolder } : {}),
        bankData: result as any,
      },
      create: {
        sellerId,
        bankAccountNumber: accountNumber,
        bankIfsc: bankIfsc,
        bankVerified: true,
        bankName: bankName || null,
        bankAccountHolder: verifiedHolder,
        bankData: result as any,
      },
    }).catch((err) => console.warn(`[InstantPay Onboarding Sync] Bank sync skipped: ${err.message}`));
  }

  const errorReason = (result as any).rawResponse?.message || (result as any).rawResponse?.status || (result.status !== "INVALID" ? result.status : null);
  res.status(200).json({
    success: result.valid,
    message: result.valid
      ? "Bank Account verified via Penny Drop successfully"
      : (errorReason ? `Penny Drop Failed: ${errorReason}` : "Bank Account Penny Drop verification failed"),
    data: result,
  });
});
