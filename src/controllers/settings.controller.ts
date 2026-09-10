import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { SETTLEMENT_CYCLE_MAP } from "../utils/enumMaps";

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      onboarding: true,
      commissionConfig: true,
      agreementConfig: true,
    },
  });

  if (!seller) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }

  // Auto-initialize commission structure if missing
  let commissionConfig = seller.commissionConfig;
  if (!commissionConfig && seller.onboarding) {
    let categories: string[] = [];
    if (seller.onboarding.productCategories) {
      if (Array.isArray(seller.onboarding.productCategories)) {
        categories = seller.onboarding.productCategories as string[];
      } else if (typeof seller.onboarding.productCategories === "string") {
        try {
          categories = JSON.parse(seller.onboarding.productCategories);
        } catch {
          categories = [seller.onboarding.productCategories];
        }
      }
    }
    if (categories.length === 0 && seller.onboarding.businessCategory) {
      categories = [seller.onboarding.businessCategory];
    }
    if (categories.length === 0) {
      categories = ["Fashion"];
    }

    const categoryCommissionsObj: Record<string, number> = {};
    const defaultRates: Record<string, number> = {
      Fashion: 12.5,
      Cosmetics: 10.0,
      Electronics: 8.0,
      Jewelry: 15.0,
      "Home & Living": 11.0,
      Footwear: 13.0,
    };
    categories.forEach((cat) => {
      categoryCommissionsObj[cat] = defaultRates[cat] || 12.0;
    });

    try {
      commissionConfig = await prisma.sellerCommissionConfig.create({
        data: {
          sellerId,
          flatOrderFee: 0.00,
          categoryCommissions: categoryCommissionsObj,
          settlementCycle: seller.onboarding.settlementCycle || "T_PLUS_7",
          notes: `Auto-initialized commission structure for ${seller.businessName || seller.onboarding.businessName || 'Seller'}`,
        },
      });
    } catch {
      // Fallback if concurrent creation occurs
    }
  }

  res.json({
    id: seller.id,
    applicationId: seller.onboarding?.applicationId,
    email: seller.email,
    phone: seller.phone,
    onboardingStatus: seller.onboardingStatus,
    onboarding: seller.onboarding,
    commissionConfig: commissionConfig || seller.commissionConfig,
    agreementConfig: seller.agreementConfig,
  });
});

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  let settings = await prisma.sellerSettings.findUnique({
    where: { sellerId },
  });

  if (!settings) {
    settings = await prisma.sellerSettings.create({
      data: { sellerId },
    });
  }

  res.json(settings);
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const {
    notifyLowStock,
    notifyNewOrder,
    notifySettlement,
    settlementCycle,
    returnPolicy,
    fulfillmentType,
    lowStockDefault,
  } = req.body;

  const cycleEnum = settlementCycle
    ? (SETTLEMENT_CYCLE_MAP[settlementCycle] ?? settlementCycle)
    : undefined;

  const updated = await prisma.sellerSettings.upsert({
    where: { sellerId },
    update: {
      notifyLowStock,
      notifyNewOrder,
      notifySettlement,
      settlementCycle: cycleEnum,
      returnPolicy,
      fulfillmentType,
      lowStockDefault,
    },
    create: {
      sellerId,
      notifyLowStock,
      notifyNewOrder,
      notifySettlement,
      settlementCycle: cycleEnum,
      returnPolicy,
      fulfillmentType,
      lowStockDefault,
    },
  });

  if (cycleEnum) {
    try {
      await prisma.sellerOnboarding.updateMany({
        where: { sellerId },
        data: { settlementCycle: cycleEnum as any },
      });
      await prisma.sellerCommissionConfig.updateMany({
        where: { sellerId },
        data: { settlementCycle: cycleEnum as any },
      });
    } catch (e) {
      console.error('Failed to sync settlementCycle across tables:', e);
    }
  }

  res.json(updated);
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const {
    brandName,
    businessName,
    category,
    businessCategory,
    brandDesc,
    description,
    contactName,
    signatoryName,
    contactEmail,
    signatoryEmail,
    contactPhone,
    signatoryMobile,
    businessAddr,
    websiteUrl,
    website,
    instaHandle,
    otherSocial,
    logoUrl,
  } = req.body;

  const resolvedName = brandName || businessName;
  const resolvedCat = category || businessCategory;
  const resolvedDesc = brandDesc !== undefined ? brandDesc : description;
  const resolvedSignatory = contactName || signatoryName;
  const resolvedEmail = contactEmail || signatoryEmail;
  const resolvedPhone = contactPhone || signatoryMobile;
  const resolvedWebsite = websiteUrl !== undefined ? websiteUrl : website;

  // 1. Update Seller record
  const sellerUpdateData: any = {};
  if (resolvedName) sellerUpdateData.businessName = resolvedName;
  if (resolvedEmail) sellerUpdateData.email = resolvedEmail;
  if (resolvedPhone) sellerUpdateData.phone = resolvedPhone;

  if (Object.keys(sellerUpdateData).length > 0) {
    await prisma.seller.update({
      where: { id: sellerId },
      data: sellerUpdateData,
    });
  }

  // 2. Upsert SellerOnboarding record
  const existingOnboarding = await prisma.sellerOnboarding.findUnique({
    where: { sellerId },
  });

  let pickupAddressData = existingOnboarding?.pickupAddress
    ? (existingOnboarding.pickupAddress as any)
    : {};

  if (businessAddr !== undefined) {
    if (typeof pickupAddressData === 'object' && pickupAddressData !== null) {
      pickupAddressData = { ...pickupAddressData, line1: businessAddr };
    } else {
      pickupAddressData = { line1: businessAddr };
    }
  }

  const onboardingUpdateData: any = {};
  if (resolvedName !== undefined) onboardingUpdateData.businessName = resolvedName;
  if (resolvedCat !== undefined) onboardingUpdateData.businessCategory = resolvedCat;
  if (resolvedDesc !== undefined) onboardingUpdateData.description = resolvedDesc;
  if (resolvedSignatory !== undefined) onboardingUpdateData.signatoryName = resolvedSignatory;
  if (resolvedEmail !== undefined) onboardingUpdateData.signatoryEmail = resolvedEmail;
  if (resolvedPhone !== undefined) onboardingUpdateData.signatoryMobile = resolvedPhone;
  if (resolvedWebsite !== undefined) onboardingUpdateData.website = resolvedWebsite;
  if (businessAddr !== undefined) onboardingUpdateData.pickupAddress = pickupAddressData;
  if (logoUrl !== undefined) onboardingUpdateData.logoUrl = logoUrl;

  const onboarding = await prisma.sellerOnboarding.upsert({
    where: { sellerId },
    update: onboardingUpdateData,
    create: {
      sellerId,
      ...onboardingUpdateData,
    },
  });

  const updatedSeller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      onboarding: true,
    },
  });

  res.json({
    message: "Profile updated successfully",
    seller: updatedSeller,
    onboarding,
  });
});


