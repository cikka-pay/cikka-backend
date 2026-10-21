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
import { ensureSeller } from "../services/onboarding.service";
import {
  getPennyDropCountInLast24Hours,
  recordPennyDropCall,
  PENNY_DROP_LIMIT,
  PENNY_DROP_EXHAUSTED_MESSAGE,
} from "../services/pennydrop-limiter.service";

/**
 * POST /api/kyc/verify-pan
 * POST /api/instantpay/verify-pan
 * Perform PAN authentication and identity verification via InstantPay.
 */
export const verifyPan = asyncHandler(async (req: Request, res: Response) => {
  const { pan, phone, isPersonal } = req.body;
  const sellerId = req.seller?.id;
  const userId = req.user?.id || sellerId;

  const result = await verifyPanService({ userId, sellerId, pan });

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

  // Sync verified PAN to User profile if mobile app user is authenticated or phone is provided
  if (req.user?.id) {
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        name: result.registeredName || undefined,
        panNumber: result.pan,
        panVerified: true,
      },
    }).catch((err) => console.warn(`[InstantPay User Sync] User name sync notice: ${err.message}`));
  } else if (phone) {
    const cleanPhoneDigits = String(phone).replace(/\D/g, "").slice(-10);
    await prisma.user.updateMany({
      where: { phone: { contains: cleanPhoneDigits } },
      data: {
        name: result.registeredName || undefined,
        panNumber: result.pan,
        panVerified: true,
      },
    }).catch((err) => console.warn(`[InstantPay User Sync] User phone sync notice: ${err.message}`));
  }

  // Sync verified PAN to SellerOnboarding if seller is authenticated
  if (sellerId) {
    await ensureSeller(sellerId);
    if (isPersonal) {
      await prisma.sellerOnboarding.upsert({
        where: { sellerId },
        update: {
          signatoryPersonalPan: result.pan,
          signatoryName: (result.registeredName && !isEntityOrCompanyName(result.registeredName)) ? result.registeredName : undefined,
        },
        create: {
          sellerId,
          signatoryPersonalPan: result.pan,
          signatoryName: (result.registeredName && !isEntityOrCompanyName(result.registeredName)) ? result.registeredName : undefined,
        },
      }).catch((err) => console.warn(`[InstantPay Onboarding Sync] Personal PAN sync skipped: ${err.message}`));
    } else {
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
  }

  res.status(200).json({
    success: true,
    message: "PAN verified successfully",
    data: {
      ...result,
      panVerified: true,
    },
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

  const formattedGstin = gstNumber ? String(gstNumber).trim().replace(/\s+/g, "").toUpperCase() : "";

  // Check for duplicate GST registration across sellers/users
  if (formattedGstin) {
    try {
      const duplicate = await prisma.sellerOnboarding.findFirst({
        where: {
          gstNumber: { equals: formattedGstin, mode: "insensitive" },
          ...(sellerId ? { sellerId: { not: sellerId } } : {}),
        },
      });

      if (duplicate) {
        res.status(400).json({
          success: false,
          error: "This GST number is not available for the registration.",
          message: "This GST number is not available for the registration.",
        });
        return;
      }
    } catch (err: any) {
      console.warn(`[Duplicate GST Check Notice] ${err.message}`);
    }
  }

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
    await ensureSeller(sellerId);
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
        businessName: result.legalName || result.tradeName || undefined,
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
    await ensureSeller(sellerId);
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
function isEntityOrCompanyName(name?: string | null): boolean {
  if (!name) return false;
  const upper = name.toUpperCase().trim();
  return (
    upper.includes("PRIVATE LIMITED") ||
    upper.includes("PVT LTD") ||
    upper.includes("PVT. LTD") ||
    upper.includes("LIMITED") ||
    upper.includes("LTD") ||
    upper.includes("LLP") ||
    upper.includes("ENTERPRISE") ||
    upper.includes("ENTERPRISES") ||
    upper.includes("SOLUTIONS") ||
    upper.includes("CORPORATION") ||
    upper.includes("CORP") ||
    upper.includes("COMPANY") ||
    upper.includes("CO.")
  );
}

export const verifyAadhaar = asyncHandler(async (req: Request, res: Response) => {
  const { aadhaarNumber, externalRef, latitude, longitude } = req.body;
  let name = (req.body.name || "").trim();
  const sellerId = req.seller?.id;
  const userId = req.user?.id;

  // Never use a corporate / entity name for an individual Aadhaar signatory
  if (isEntityOrCompanyName(name)) {
    name = "";
  }

  // If human signatory name was not provided, resolve from existing verified signatory records
  if (!name && sellerId) {
    try {
      const ob = await prisma.sellerOnboarding.findUnique({
        where: { sellerId },
        select: { signatoryName: true },
      });
      if (
        ob?.signatoryName &&
        !isEntityOrCompanyName(ob.signatoryName) &&
        ob.signatoryName !== "Aadhaar Verified" &&
        ob.signatoryName !== "Authorized Signatory"
      ) {
        name = ob.signatoryName.trim();
      } else {
        const sellerRec = await prisma.seller.findUnique({
          where: { id: sellerId },
          select: { phone: true, email: true },
        });
        const match = await prisma.sellerOnboarding.findFirst({
          where: {
            OR: [
              ...(aadhaarNumber ? [{ signatoryAadhaar: aadhaarNumber }] : []),
              ...(sellerRec?.phone ? [{ seller: { phone: sellerRec.phone } }] : []),
              ...(sellerRec?.email ? [{ seller: { email: sellerRec.email } }] : []),
            ],
            AND: [
              { signatoryName: { not: null } },
              { signatoryName: { notIn: ["Aadhaar Verified", "Authorized Signatory", ""] } },
            ],
          },
          select: { signatoryName: true },
          orderBy: { updatedAt: "desc" },
        });
        if (match?.signatoryName && !isEntityOrCompanyName(match.signatoryName)) {
          name = match.signatoryName.trim();
        }
      }
    } catch (e: any) {
      console.warn(`[Aadhaar Name Resolution Warning] ${e.message}`);
    }
  }

  const result = await verifyAadhaarService({
    sellerId,
    userId,
    aadhaarNumber,
    name: name || undefined,
    externalRef,
    latitude,
    longitude,
  });

  const failureMessage =
    result.error ||
    (result.status && result.status !== "VALID" ? `Aadhaar verification failed: ${result.status}` : "Aadhaar verification failed");

  let resolvedHolderName =
    result.aadhaarHolderName && !isEntityOrCompanyName(result.aadhaarHolderName)
      ? result.aadhaarHolderName
      : (name && !isEntityOrCompanyName(name) ? name : undefined);

  // Sync verified Aadhaar to SellerOnboarding if seller is authenticated
  if (result.valid && sellerId) {
    const rawHolder = (resolvedHolderName || result.aadhaarHolderName || name || "").trim();
    const verifiedName =
      rawHolder &&
      !isEntityOrCompanyName(rawHolder) &&
      rawHolder !== "Aadhaar Verified" &&
      rawHolder !== "Authorized Signatory"
        ? rawHolder
        : undefined;

    await ensureSeller(sellerId);
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
        ...(verifiedName ? { signatoryName: verifiedName } : {}),
      },
    }).catch((err) => console.warn(`[InstantPay Onboarding Sync] Aadhaar sync skipped: ${err.message}`));
  }

  res.status(200).json({
    success: true,
    data: {
      ...result,
      aadhaarHolderName: resolvedHolderName,
    },
    message: result.valid ? "Aadhaar verification successful" : failureMessage,
    error: result.valid ? undefined : failureMessage,
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
  const count = await getPennyDropCountInLast24Hours(req);
  if (count >= PENNY_DROP_LIMIT) {
    res.status(429).json({
      success: false,
      message: PENNY_DROP_EXHAUSTED_MESSAGE,
      error: PENNY_DROP_EXHAUSTED_MESSAGE,
    });
    return;
  }

  // Record this penny drop API trigger
  recordPennyDropCall(req);

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
    await ensureSeller(sellerId);
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
