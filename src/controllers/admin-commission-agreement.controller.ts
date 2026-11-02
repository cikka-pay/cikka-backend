import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { SETTLEMENT_CYCLE_MAP } from "../utils/enumMaps";
import { calculateSettlementBreakdown } from "../services/settlementCalculator.service";

export const getSellerCommissionConfig = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: { onboarding: true },
  });

  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  // Extract seller's onboarding categories (from productCategories array/JSON or businessCategory)
  let categories: string[] = [];
  if (seller.onboarding?.productCategories) {
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
  if (categories.length === 0 && seller.onboarding?.businessCategory) {
    categories = [seller.onboarding.businessCategory];
  }
  if (categories.length === 0) {
    categories = ["Fashion", "Cosmetics", "Electronics", "Jewelry", "Home & Living", "Footwear"];
  }

  let config = await prisma.sellerCommissionConfig.findUnique({
    where: { sellerId },
  });

  const [onboarding, agreement] = await Promise.all([
    prisma.sellerOnboarding.findUnique({ where: { sellerId } }),
    prisma.sellerAgreementConfig.findUnique({ where: { sellerId } }),
  ]);
  const applicationId = onboarding?.applicationId || `CKA-${seller.id.slice(0, 6).toUpperCase()}`;
  const isLocked = Boolean(
    onboarding?.commissionAcknowledged ||
    onboarding?.merchantAgreementAccepted ||
    ((agreement?.status === "ACCEPTED" || agreement?.status === "ACTIVE") && agreement?.signedAt)
  );

  if (!config) {
    // POLICY: 22% default across every segment!
    const categoryCommissionsObj: Record<string, number> = {};
    categories.forEach((cat) => {
      categoryCommissionsObj[cat] = 22.0;
    });

    const rawCycle = seller.onboarding?.settlementCycle || "T_PLUS_7";
    const initialCycle = rawCycle === "T_PLUS_14" ? "T_PLUS_14" : "T_PLUS_7";

    config = await prisma.sellerCommissionConfig.create({
      data: {
        sellerId,
        flatOrderFee: 15.00,
        categoryCommissions: categoryCommissionsObj,
        settlementCycle: initialCycle as any,
        notes: `Standard 22% commission structure for ${seller.businessName || 'Seller'} (${applicationId})`,
      },
    });
  } else if (config.categoryCommissions && typeof config.categoryCommissions === "object") {
    const existing = config.categoryCommissions as Record<string, number>;
    let missingFound = false;
    categories.forEach((cat) => {
      if (existing[cat] === undefined) {
        existing[cat] = 22.0; // Enforce 22.0% default
        missingFound = true;
      }
    });
    if (missingFound) {
      config = await prisma.sellerCommissionConfig.update({
        where: { sellerId },
        data: { categoryCommissions: existing },
      });
    }
  }

  res.json({
    commissionConfig: config,
    sellerCategories: categories,
    businessCategory: seller.onboarding?.businessCategory || null,
    isLocked,
    applicationId,
    brandName: seller.businessName || seller.onboarding?.businessName,
    defaultRate: 22.0,
    allowedCycles: ["T_PLUS_7", "T_PLUS_14"],
  });
});

export const updateSellerCommissionConfig = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;
  const { flatOrderFee, categoryCommissions, settlementCycle, notes } = req.body;

  // Strict Policy: Only T_PLUS_7 and T_PLUS_14 allowed
  let cycleEnum: string | undefined = undefined;
  if (settlementCycle) {
    const mapped = SETTLEMENT_CYCLE_MAP[settlementCycle] ?? settlementCycle;
    cycleEnum = mapped === "T_PLUS_14" ? "T_PLUS_14" : "T_PLUS_7";
  }

  const [onboarding, agreement, seller] = await Promise.all([
    prisma.sellerOnboarding.findUnique({ where: { sellerId } }),
    prisma.sellerAgreementConfig.findUnique({ where: { sellerId } }),
    prisma.seller.findUnique({ where: { id: sellerId } }),
  ]);

  const applicationId = onboarding?.applicationId || `CKA-${sellerId.slice(0, 6).toUpperCase()}`;
  const isLocked = Boolean(
    onboarding?.commissionAcknowledged ||
    onboarding?.merchantAgreementAccepted ||
    ((agreement?.status === "ACCEPTED" || agreement?.status === "ACTIVE") && agreement?.signedAt)
  );

  const fallbackCategories = { Fashion: 22.0, Cosmetics: 22.0, Electronics: 22.0 };

  const config = await prisma.sellerCommissionConfig.upsert({
    where: { sellerId },
    update: {
      flatOrderFee: flatOrderFee !== undefined ? flatOrderFee : undefined,
      categoryCommissions: categoryCommissions !== undefined ? categoryCommissions : undefined,
      settlementCycle: (cycleEnum as any) || undefined,
      notes: notes !== undefined ? notes : (isLocked ? `Locked under signed Merchant Agreement (${applicationId})` : undefined),
      effectiveFrom: new Date(),
    },
    create: {
      sellerId,
      flatOrderFee: flatOrderFee ?? 15.00,
      categoryCommissions: categoryCommissions ?? fallbackCategories,
      settlementCycle: (cycleEnum as any) || "T_PLUS_7",
      notes: notes || (isLocked ? `Locked under signed Merchant Agreement (${applicationId})` : "Configured via Seller Dashboard Admin"),
    },
  });

  // Sync settlement cycle across sellerSettings and sellerOnboarding
  if (cycleEnum) {
    try {
      await Promise.all([
        prisma.sellerSettings.updateMany({
          where: { sellerId },
          data: { settlementCycle: cycleEnum as any },
        }),
        prisma.sellerOnboarding.updateMany({
          where: { sellerId },
          data: { settlementCycle: cycleEnum as any },
        }),
      ]);
    } catch (e) {
      console.warn("Failed to sync settlementCycle across tables:", e);
    }
  }

  // Recalculate any pending untransferred settlements with new commission structure
  try {
    const untransferredSettlements = await prisma.settlement.findMany({
      where: {
        sellerId,
        status: "PENDING",
        razorpayTransferId: null,
      },
    });

    for (const st of untransferredSettlements) {
      if (Number(st.grossSales) > 0) {
        const cat = st.category || undefined;
        let commRate = 22.0;
        if (categoryCommissions && typeof categoryCommissions === "object") {
          if (cat && categoryCommissions[cat] !== undefined) {
            commRate = Number(categoryCommissions[cat]);
          } else {
            const firstVal = Object.values(categoryCommissions)[0];
            if (firstVal !== undefined) commRate = Number(firstVal);
          }
        }
        const updatedBreakdown = calculateSettlementBreakdown(
          Number(st.grossSales),
          {
            commissionRate: commRate,
            sellerPlatformFee: flatOrderFee !== undefined ? Number(flatOrderFee) : undefined,
          }
        );

        let holdDays = 7;
        if (cycleEnum === "T_PLUS_1") holdDays = 1;
        else if (cycleEnum === "T_PLUS_3") holdDays = 3;
        else if (cycleEnum === "T_PLUS_7") holdDays = 7;
        else if (cycleEnum === "T_PLUS_14") holdDays = 14;

        const newHoldUntil = new Date(Date.now() + holdDays * 86400000);

        await prisma.settlement.update({
          where: { id: st.id },
          data: {
            commissionRate: updatedBreakdown.commissionRate,
            commissionAmount: updatedBreakdown.commission,
            commissionTotal: updatedBreakdown.commissionTotal,
            sellerPlatformFee: updatedBreakdown.sellerPlatformFee,
            sellerPlatformTotal: updatedBreakdown.sellerPlatformTotal,
            totalDeductions: updatedBreakdown.totalSellerDeductions,
            netPayable: updatedBreakdown.sellerNetSettlement,
            holdUntil: newHoldUntil,
            payoutDate: newHoldUntil,
            ledgerBreakdown: updatedBreakdown as any,
          } as any,
        });
      }
    }
  } catch (recalcErr) {
    console.warn("Notice: Failed to recalculate pending settlements:", recalcErr);
  }

  // Notify seller of commission structure change
  await prisma.notification.create({
    data: {
      sellerId,
      type: "SETTLEMENT",
      title: "Merchant Commission & Settlement Terms Updated",
      body: "Your customized commission structure and settlement cycle have been updated by Cikka Compliance Administration.",
    },
  });

  res.json({ message: "Commission configuration saved successfully", commissionConfig: config });
});

export const getSellerAgreementConfig = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;

  try {
    let agreement = await prisma.sellerAgreementConfig.findUnique({
      where: { sellerId },
    });

    if (!agreement) {
      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { onboarding: true },
      });

      if (seller) {
        const companyName = seller.onboarding?.businessName || seller.businessName || "Merchant Company";

        agreement = await prisma.sellerAgreementConfig.create({
          data: {
            sellerId,
            version: "1.0",
            status: "ACTIVE",
            customText: `## Master Cikka Seller & Merchant Service Agreement\n\nThis Agreement is entered into between **Cikka E-Commerce Technologies Pvt Ltd** and **${companyName}**.\n\n### 1. Verification & Compliance\nThe Merchant agrees to provide authentic GSTIN, PAN, and Bank details for verification.\n\n### 2. Settlement & Payouts\nSettlements shall be calculated net of applicable category commission rates and flat order handling fees.\n\n### 3. Return & Exchange Policy\nThe Merchant shall honor customer return policies within the stipulated window.`,
            customClauses: [
              { id: "c1", title: "Authenticity Guarantee", content: "Merchant warrants that all products supplied are 100% genuine and original.", isMandatory: true },
              { id: "c2", title: "SLA Dispatch Window", content: "Merchant agrees to dispatch orders within 24 hours of receiving notifications.", isMandatory: true },
            ],
          },
        });
      }
    }

    if (agreement) {
      res.json({ agreementConfig: agreement });
      return;
    }
  } catch (err) {
    console.warn(`[getSellerAgreementConfig] Fallback triggered for seller ${sellerId}:`, err);
  }

  // Fallback response if database model isn't created/migrated yet
  res.json({
    agreementConfig: {
      sellerId,
      version: "1.2",
      status: "ACTIVE",
      customText: `✦ Special Company Operational Addendum:\n• Agreed Settlement Cycle: T+7 with rolling 5% reserve buffer.\n• Category Special Commission Rate: Customized structure as approved by Cikka Compliance Officer.`,
      customClauses: [
        { id: "c1", title: "Authenticity Warranty", content: "Merchant guarantees 100% original products without counterfeit items.", isMandatory: true },
        { id: "c2", title: "24-Hour Dispatch SLA", content: "Orders must be marked packed and ready for carrier pickup within 24 hours.", isMandatory: true },
        { id: "c3", title: "Return Window Acceptance", content: "Merchant agrees to accept customer returns within 7 calendar days.", isMandatory: false },
      ],
    },
  });
});

export const updateSellerAgreementConfig = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;
  const { customText, customClauses, version, status } = req.body;

  const agreement = await prisma.sellerAgreementConfig.upsert({
    where: { sellerId },
    update: {
      customText: customText !== undefined ? customText : undefined,
      customClauses: customClauses !== undefined ? customClauses : undefined,
      version: version || undefined,
      status: status || undefined,
    },
    create: {
      sellerId,
      customText: customText || "Customized Cikka Merchant Agreement",
      customClauses: customClauses || [],
      version: version || "1.0",
      status: status || "ACTIVE",
    },
  });

  // Notify seller of updated agreement
  await prisma.notification.create({
    data: {
      sellerId,
      type: "KYB",
      title: "Merchant Agreement Terms Updated",
      body: `Your customized Cikka Merchant Agreement (v${agreement.version}) has been updated by Compliance Admin.`,
    },
  });

  res.json({ message: "Merchant agreement saved successfully", agreementConfig: agreement });
});
