import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: { onboarding: true },
  });

  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  res.json({
    id: seller.id,
    applicationId: seller.onboarding?.applicationId,
    email: seller.email,
    phone: seller.phone,
    onboardingStatus: seller.onboardingStatus,
    onboarding: seller.onboarding,
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
  const { notifyLowStock, notifyNewOrder, notifySettlement } = req.body;

  const updated = await prisma.sellerSettings.upsert({
    where: { sellerId },
    update: {
      notifyLowStock,
      notifyNewOrder,
      notifySettlement,
    },
    create: {
      sellerId,
      notifyLowStock,
      notifyNewOrder,
      notifySettlement,
    },
  });

  res.json(updated);
});
