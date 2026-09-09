import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const getApplications = asyncHandler(async (req: Request, res: Response) => {
  const { status, search } = req.query;

  const whereClause: any = {};
  if (status && status !== "ALL") {
    whereClause.onboardingStatus = status as any;
  } else {
    // Hide unsubmitted/incomplete draft applications created on signup until Step 5 (Brand) or Submission
    whereClause.onboardingStatus = { in: ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED"] };
  }

  if (search) {
    whereClause.OR = [
      { businessName: { contains: String(search), mode: "insensitive" } },
      { email: { contains: String(search), mode: "insensitive" } },
      { phone: { contains: String(search), mode: "insensitive" } },
    ];
  }

  const sellers = await prisma.seller.findMany({
    where: whereClause,
    include: {
      onboarding: true,
      settings: true,
      commissionConfig: true,
      agreementConfig: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ applications: sellers });
});

export const getApplicationById = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      onboarding: true,
      settings: true,
      commissionConfig: true,
      agreementConfig: true,
      notifications: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!seller) {
    res.status(404).json({ error: "Seller application not found" });
    return;
  }

  res.json({ application: seller });
});

export const updateApplicationStatus = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;
  const { status, reviewNotes, reviewedBy } = req.body;

  if (!status) {
    res.status(400).json({ error: "Status is required" });
    return;
  }

  const isApproved = status === "VERIFIED";

  // Ensure seller onboarding record exists
  const existingOnboarding = await prisma.sellerOnboarding.findUnique({ where: { sellerId } });

  const updatedSeller = await prisma.seller.update({
    where: { id: sellerId },
    data: {
      onboardingStatus: status,
      kycVerified: isApproved,
      ...(existingOnboarding
        ? {
            onboarding: {
              update: {
                verificationNotes: reviewNotes,
                reviewedBy: reviewedBy || "Seller Admin Officer",
                reviewedAt: new Date(),
              },
            },
          }
        : {}),
    },
    include: {
      onboarding: true,
      agreementConfig: true,
      commissionConfig: true,
    },
  });

  // Create real-time notification for the seller's dashboard
  await prisma.notification.create({
    data: {
      sellerId,
      type: "KYB",
      title: isApproved ? "Application Approved! 🎉" : `Application Status Updated: ${status}`,
      body: isApproved
        ? "Your Cikka Seller Application has been fully verified and approved by Compliance! Please review and e-sign your Merchant Agreement to activate your dashboard."
        : `Your seller application status is now ${status}. ${reviewNotes || ""}`,
    },
  });

  res.json({ message: "Application status updated successfully", seller: updatedSeller });
});

export const notifyMissingDocument = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;
  const { documentKey, documentTitle, reason } = req.body;

  if (!documentTitle || !reason) {
    res.status(400).json({ error: "Document title and rejection reason are required" });
    return;
  }

  const onboarding = await prisma.sellerOnboarding.findUnique({
    where: { sellerId },
  });

  if (!onboarding) {
    res.status(404).json({ error: "Seller onboarding record not found" });
    return;
  }

  const existingDocs = (onboarding.missingDocuments as any[]) || [];
  const newMissingItem = {
    key: documentKey || `doc_${Date.now()}`,
    title: documentTitle,
    reason,
    requestedAt: new Date().toISOString(),
    resolved: false,
  };

  const updatedDocs = [newMissingItem, ...existingDocs];

  await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      missingDocuments: updatedDocs,
      verificationNotes: `Missing Document requested: ${documentTitle} - Reason: ${reason}`,
    },
  });

  // Create real-time notification for the seller's dashboard
  const notification = await prisma.notification.create({
    data: {
      sellerId,
      type: "KYB",
      title: `Action Required: Document Issue (${documentTitle})`,
      body: `Verification Notice: ${reason}. Please update or re-upload your ${documentTitle} in the onboarding portal.`,
      metadata: { missingDocumentKey: newMissingItem.key, title: documentTitle, reason },
    },
  });

  res.json({
    message: "Missing document notification sent to seller",
    missingDocument: newMissingItem,
    notification,
  });
});

export const deleteApplication = asyncHandler(async (req: Request, res: Response) => {
  const { sellerId } = req.params;

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
  });

  if (!seller) {
    res.status(404).json({ error: "Seller application not found" });
    return;
  }

  // Safely delete all associated seller records in transaction
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { sellerId } }),
    prisma.sellerAgreementConfig.deleteMany({ where: { sellerId } }),
    prisma.sellerCommissionConfig.deleteMany({ where: { sellerId } }),
    prisma.sellerSettings.deleteMany({ where: { sellerId } }),
    prisma.sellerOnboarding.deleteMany({ where: { sellerId } }),
    prisma.settlement.deleteMany({ where: { sellerId } }),
    prisma.order.deleteMany({ where: { sellerId } }),
    prisma.product.deleteMany({ where: { sellerId } }),
    prisma.seller.delete({ where: { id: sellerId } }),
  ]);

  res.json({ message: "Seller application permanently deleted", sellerId });
});
