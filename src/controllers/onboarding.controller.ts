import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import * as onboardingService from "../services/onboarding.service";
import { BUSINESS_TYPE_MAP, FULFILLMENT_TYPE_MAP, SETTLEMENT_CYCLE_MAP } from "../utils/enumMaps";

export const getOnboardingState = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const onboarding = await prisma.sellerOnboarding.findUnique({
    where: { sellerId },
  });
  res.json({ onboarding });
});

export const updateStep1 = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const data = req.body;

  // Create if doesn't exist
  await onboardingService.getOrCreateOnboarding(sellerId);

  // Sync business name to seller table
  if (data.businessName) {
    await prisma.seller.update({
      where: { id: sellerId },
      data: { businessName: data.businessName },
    });
  }

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      businessName: data.businessName,
      // Map UI human-readable label → Prisma enum (e.g. "Private Limited (Pvt Ltd)" → PRIVATE_LIMITED)
      businessType: data.businessType ? BUSINESS_TYPE_MAP[data.businessType] ?? data.businessType : undefined,
      yearEstablished: data.yearEstablished,
      businessCategory: data.businessCategory,
      description: data.description,
      website: data.website,
      completedSteps: 1,
    },
  });

  res.json(onboarding);
});

export const updateStep2 = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const data = req.body;

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      gstNumber: data.gstNumber,
      panNumber: data.panNumber,
      cinNumber: data.cinNumber,
      msmeNumber: data.msmeNumber,
      completedSteps: 2,
    },
  });

  res.json(onboarding);
});

export const verifyGst = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { gstNumber } = req.body;
  const result = await onboardingService.verifyGst(sellerId, gstNumber);
  res.json(result);
});

export const verifyPan = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { panNumber } = req.body;
  const result = await onboardingService.verifyPan(sellerId, panNumber);
  res.json(result);
});

export const verifyCin = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { cinNumber } = req.body;
  const result = await onboardingService.verifyCin(sellerId, cinNumber);
  res.json(result);
});

export const updateStep3 = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const data = req.body;

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      signatoryName: data.signatoryName,
      signatoryTitle: data.signatoryTitle,
      signatoryPersonalPan: data.signatoryPersonalPan,
      signatoryAadhaar: data.signatoryAadhaar,
      signatoryMobile: data.signatoryMobile,
      signatoryEmail: data.signatoryEmail,
      completedSteps: 3,
    },
  });

  res.json(onboarding);
});

export const sendAadhaarOtp = asyncHandler(async (req: Request, res: Response) => {
  const { aadhaar, mobile } = req.body;
  const result = await onboardingService.sendAadhaarOtp(aadhaar, mobile);
  res.json(result);
});

export const verifyAadhaarOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { referenceId, otp } = req.body;
  const result = await onboardingService.verifyAadhaarOtp(sellerId, referenceId, otp);
  if (!result.valid) {
    res.status(400).json({ error: "Invalid OTP" });
    return;
  }
  res.json(result);
});

export const updateStep4 = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const data = req.body;

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      bankAccountHolder: data.bankAccountHolder,
      bankName: data.bankName,
      bankAccountNumber: data.bankAccountNumber,
      bankIfsc: data.bankIfsc,
      completedSteps: 4,
    },
  });

  res.json(onboarding);
});

export const verifyBank = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { ifsc, accountNumber } = req.body;
  const result = await onboardingService.verifyBank(sellerId, ifsc, accountNumber);
  res.json(result);
});

export const updateStep5 = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const data = req.body;

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      logoUrl: data.logoUrl,
      productCategories: data.productCategories,
      returnPolicy: data.returnPolicy,
      avgOrderValue: data.avgOrderValue,
      monthlySalesTarget: data.monthlySalesTarget,
      // Map UI values → Prisma enums
      settlementCycle: data.settlementCycle
        ? SETTLEMENT_CYCLE_MAP[data.settlementCycle] ?? data.settlementCycle
        : undefined,
      fulfillmentType: data.fulfillmentType
        ? FULFILLMENT_TYPE_MAP[data.fulfillmentType] ?? data.fulfillmentType
        : undefined,
      pickupAddress: data.pickupAddress,
      completedSteps: 5,
    },
  });

  res.json(onboarding);
});

export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  
  // Real implementation will use storage service
  const url = `/uploads/${req.file.filename}`;
  await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: { logoUrl: url },
  });
  
  res.json({ url });
});

export const updateStep6 = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const data = req.body;

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      merchantAgreementAccepted: data.merchantAgreementAccepted,
      commissionAcknowledged: data.commissionAcknowledged,
      returnPolicyAcknowledged: data.returnPolicyAcknowledged,
      authenticityAcknowledged: data.authenticityAcknowledged,
      digitalSignature: data.digitalSignature,
      agreementAcceptedAt: new Date(),
      completedSteps: 6,
    },
  });

  res.json(onboarding);
});

export const submitApplication = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const onboarding = await prisma.sellerOnboarding.findUnique({ where: { sellerId } });
  
  if (!onboarding || onboarding.completedSteps < 6) {
    res.status(400).json({ error: "All steps must be completed before submission" });
    return;
  }

  const result = await onboardingService.submitOnboarding(sellerId);
  res.json({ 
    message: "Application submitted successfully",
    applicationId: result.applicationId,
    status: "SUBMITTED"
  });
});
