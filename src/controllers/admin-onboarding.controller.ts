import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { sendSellerWelcomeEmail, sendSellerRejectionEmail } from "../utils/resend";
import { generateApplicationId } from "../services/auth.service";
import { razorpayRouteService } from "../services/razorpayRoute.service";

export const getApplications = asyncHandler(async (req: Request, res: Response) => {
  const { status, search } = req.query;

  const whereClause: any = {};
  if (status && status !== "ALL") {
    whereClause.onboardingStatus = status as any;
  } else {
    // Hide unsubmitted/incomplete draft applications created on signup until Step 5 (Brand) or Submission
    whereClause.onboardingStatus = { in: ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED"] };
  }

  // Hide test accounts created by integration tests from the live admin feed
  whereClause.email = { not: { endsWith: "@testbrand.com" } };

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

  // Ensure every seller has a CKA029XXX Cikka ID
  for (const seller of sellers) {
    if (seller.onboarding) {
      const currentId = seller.onboarding.applicationId;
      if (!currentId || !currentId.startsWith("CKA029")) {
        let newAppId: string;
        if (currentId && currentId.startsWith("CKA-")) {
          const digits = currentId.replace(/\D/g, "").slice(-3).padStart(3, "0");
          newAppId = `CKA029${digits}`;
        } else {
          newAppId = generateApplicationId();
        }
        await prisma.sellerOnboarding.update({
          where: { sellerId: seller.id },
          data: { applicationId: newAppId },
        }).catch(() => {});
        seller.onboarding.applicationId = newAppId;
      }
    }
  }

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

  if (seller.onboarding) {
    const currentId = seller.onboarding.applicationId;
    if (!currentId || !currentId.startsWith("CKA029")) {
      let newAppId: string;
      if (currentId && currentId.startsWith("CKA-")) {
        const digits = currentId.replace(/\D/g, "").slice(-3).padStart(3, "0");
        newAppId = `CKA029${digits}`;
      } else {
        newAppId = generateApplicationId();
      }
      await prisma.sellerOnboarding.update({
        where: { sellerId: seller.id },
        data: { applicationId: newAppId },
      }).catch(() => {});
      seller.onboarding.applicationId = newAppId;
    }
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

  // Fetch previous seller status to prevent duplicate email triggers on re-save
  const previousSeller = await prisma.seller.findUnique({ where: { id: sellerId } });

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

  // Provision Razorpay Route Linked Account whenever seller is approved
  if (isApproved) {
    try {
      const linkedAccResult = await razorpayRouteService.createLinkedAccount({
        sellerId: updatedSeller.id,
        businessName: updatedSeller.businessName || updatedSeller.onboarding?.businessName || "Merchant Partner",
        businessType: updatedSeller.onboarding?.businessType as any,
        email: updatedSeller.email || updatedSeller.onboarding?.signatoryEmail || "seller@cikka.club",
        phone: updatedSeller.phone,
        signatoryName: updatedSeller.onboarding?.signatoryName || undefined,
        panNumber: updatedSeller.onboarding?.panNumber || updatedSeller.onboarding?.signatoryPersonalPan || undefined,
        gstNumber: updatedSeller.onboarding?.gstNumber || undefined,
        bankAccountNumber: updatedSeller.onboarding?.bankAccountNumber || undefined,
        bankIfsc: updatedSeller.onboarding?.bankIfsc || undefined,
        bankAccountHolder: updatedSeller.onboarding?.bankAccountHolder || undefined,
        address: updatedSeller.onboarding?.pickupAddress as any,
      });
      console.log(`[Admin Approval] Razorpay Route Linked Account status: ${linkedAccResult.status}, ID: ${linkedAccResult.accountId}`);
    } catch (err: any) {
      console.warn(`[Razorpay Route Auto-Provisioning Notice] ${err.message}`);
    }
  }

  // Send Resend Welcome Email to Seller ONCE when status transitions to VERIFIED
  if (isApproved && previousSeller?.onboardingStatus !== "VERIFIED") {
    const sellerEmail = updatedSeller.email || updatedSeller.onboarding?.signatoryEmail || process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";
    sendSellerWelcomeEmail({
      to: sellerEmail,
      sellerName: updatedSeller.businessName || updatedSeller.onboarding?.signatoryName || "Partner",
    }).catch((err) => console.error("Failed to send welcome email via Resend:", err));
  }

  // Send Resend Rejection Email to Seller ONCE when status transitions to REJECTED
  if (status === "REJECTED" && previousSeller?.onboardingStatus !== "REJECTED") {
    const sellerEmail = updatedSeller.email || updatedSeller.onboarding?.signatoryEmail || process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";
    sendSellerRejectionEmail({
      to: sellerEmail,
      sellerName: updatedSeller.businessName || updatedSeller.onboarding?.signatoryName || "Partner",
      reason: reviewNotes || "Document verification details required updating",
    }).catch((err) => console.error("Failed to send rejection email via Resend:", err));
  }

  const finalSeller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      onboarding: true,
      agreementConfig: true,
      commissionConfig: true,
    },
  });

  res.json({ message: "Application status updated successfully", seller: finalSeller || updatedSeller });
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

export const getApprovedSellers = asyncHandler(async (req: Request, res: Response) => {
  const sellers = await prisma.seller.findMany({
    where: { 
      onboardingStatus: "VERIFIED",
      email: { not: { endsWith: "@testbrand.com" } }
    },
    include: {
      onboarding: true,
      settings: true,
      products: {
        where: { status: 'PENDING_APPROVAL' },
        select: { id: true }
      }
    },
    orderBy: { updatedAt: "desc" },
  });

  // Ensure every seller has a CKA029XXX Cikka ID
  for (const seller of sellers) {
    if (seller.onboarding) {
      const currentId = seller.onboarding.applicationId;
      if (!currentId || !currentId.startsWith("CKA029")) {
        let newAppId: string;
        if (currentId && currentId.startsWith("CKA-")) {
          const digits = currentId.replace(/\D/g, "").slice(-3).padStart(3, "0");
          newAppId = `CKA029${digits}`;
        } else {
          newAppId = generateApplicationId();
        }
        await prisma.sellerOnboarding.update({
          where: { sellerId: seller.id },
          data: { applicationId: newAppId },
        }).catch(() => {});
        seller.onboarding.applicationId = newAppId;
      }
    }
  }

  const enrichedSellers = sellers.map(s => ({
    ...s,
    cikkaId: s.onboarding?.applicationId || null,
    pendingProductsCount: s.products.length
  }));

  res.json(enrichedSellers);
});

export const getSellerProducts = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const products = await prisma.product.findMany({
    where: { sellerId: id },
    include: { variants: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(products);
});

export const updateProductApproval = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body; // ACTIVE or REJECTED

  if (!["ACTIVE", "REJECTED"].includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const product = await prisma.product.update({
    where: { id },
    data: { status },
  });
  res.json(product);
});
