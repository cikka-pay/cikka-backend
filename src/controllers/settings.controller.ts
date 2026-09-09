import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

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
    res.status(404).json({ error: "Seller not found" });
    return;
  }

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
          flatOrderFee: 15.00,
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

  const updated = await prisma.sellerSettings.upsert({
    where: { sellerId },
    update: {
      notifyLowStock,
      notifyNewOrder,
      notifySettlement,
      settlementCycle,
      returnPolicy,
      fulfillmentType,
      lowStockDefault,
    },
    create: {
      sellerId,
      notifyLowStock,
      notifyNewOrder,
      notifySettlement,
      settlementCycle,
      returnPolicy,
      fulfillmentType,
      lowStockDefault,
    },
  });

  res.json(updated);
});

