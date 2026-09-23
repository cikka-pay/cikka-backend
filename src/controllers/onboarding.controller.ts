import { Request, Response } from "express";
import dns from "dns/promises";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import * as onboardingService from "../services/onboarding.service";
import { BUSINESS_TYPE_MAP, FULFILLMENT_TYPE_MAP, SETTLEMENT_CYCLE_MAP } from "../utils/enumMaps";
import { sendSellerWaitlistEmail } from "../utils/resend";
import { generateApplicationId } from "../services/auth.service";


export const getOnboardingState = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: {
      onboarding: true,
      agreementConfig: true,
      commissionConfig: true,
    },
  });

  if (!seller) {
    res.status(404).json({ error: "Seller profile not found" });
    return;
  }

  // Ensure seller onboarding record has a CKA029XXX formatted unique Cikka ID
  let cikkaId = seller.onboarding?.applicationId;
  if (seller.onboarding && (!cikkaId || !cikkaId.startsWith("CKA029"))) {
    cikkaId = generateApplicationId();
    await prisma.sellerOnboarding.update({
      where: { sellerId: seller.id },
      data: { applicationId: cikkaId },
    }).catch(() => {});
    seller.onboarding.applicationId = cikkaId;
  }

  res.json({
    sellerId: seller.id,
    email: seller.email,
    businessName: seller.businessName,
    onboardingStatus: seller.onboardingStatus,
    kycVerified: seller.kycVerified,
    applicationId: seller.onboarding?.applicationId || null,
    submittedAt: seller.onboarding?.submittedAt || null,
    onboarding: seller.onboarding,
    agreementConfig: seller.agreementConfig,
    commissionConfig: seller.commissionConfig,
  });
});

export const getMerchantAgreement = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;

  let agreement = await prisma.sellerAgreementConfig.findUnique({
    where: { sellerId },
  });

  if (!agreement) {
    const seller = await prisma.seller.findUnique({
      where: { id: sellerId },
      include: { onboarding: true },
    });

    const companyName = seller?.onboarding?.businessName || seller?.businessName || "Merchant Company";

    agreement = await prisma.sellerAgreementConfig.create({
      data: {
        sellerId,
        version: "1.0",
        status: "ACTIVE",
        customText: `## Master Cikka Seller & Merchant Service Agreement\n\nThis Agreement is entered into between **Sorvantis Platforms Private Limited (Cikka)** and **${companyName}**.\n\n### 1. Verification & Compliance\nThe Merchant agrees to provide authentic GSTIN, PAN, and Bank details for verification.\n\n### 2. Settlement & Payouts\nSettlements shall be calculated net of applicable category commission rates and flat order handling fees.\n\n### 3. Return & Exchange Policy\nThe Merchant shall honor customer return policies within the stipulated window.`,
        customClauses: [
          { id: "c1", title: "Authenticity Guarantee", content: "Merchant warrants that all products supplied are 100% genuine and original.", isMandatory: true },
          { id: "c2", title: "SLA Dispatch Window", content: "Merchant agrees to dispatch orders within committed windows.", isMandatory: true },
        ],
      },
    });
  }

  res.json({ agreementConfig: agreement });
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
      // Map UI human-readable label → Prisma enum (e.g. "pvt_ltd" → PRIVATE_LIMITED)
      businessType: data.businessType ? BUSINESS_TYPE_MAP[data.businessType] ?? data.businessType : undefined,
      yearEstablished: data.yearEstablished ? Number(data.yearEstablished) : undefined,
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

  // Sync email to Seller record if provided
  if (data.signatoryEmail && data.signatoryEmail.trim()) {
    await prisma.seller.update({
      where: { id: sellerId },
      data: { email: data.signatoryEmail.trim() },
    }).catch(() => {});
  }

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
      bankVerified: data.bankVerified !== undefined ? Boolean(data.bankVerified) : true,
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

  const existingSeller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: { onboarding: true },
  });

  const existingId = existingSeller?.onboarding?.applicationId;
  const appId = existingId && existingId.startsWith("CKA029")
    ? existingId
    : generateApplicationId();

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      logoUrl: data.logoUrl,
      productCategories: data.productCategories,
      returnPolicy: data.returnPolicy,
      avgOrderValue: data.avgOrderValue ? Number(data.avgOrderValue) : undefined,
      monthlySalesTarget: data.monthlySalesTarget ? Number(data.monthlySalesTarget) : undefined,
      // Map UI values → Prisma enums
      settlementCycle: data.settlementCycle
        ? SETTLEMENT_CYCLE_MAP[data.settlementCycle] ?? data.settlementCycle
        : undefined,
      fulfillmentType: data.fulfillmentType
        ? FULFILLMENT_TYPE_MAP[data.fulfillmentType] ?? data.fulfillmentType
        : undefined,
      pickupAddress: data.pickupAddress,
      completedSteps: 5,
      applicationId: appId,
      submittedAt: existingSeller?.onboarding?.submittedAt || new Date(),
    },
  });

  // Automatically transition onboardingStatus to SUBMITTED when Brand Step 5 is saved
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      onboardingStatus: "SUBMITTED",
    },
  });

  // Dispatch Resend "Application Under Review" Email to Seller ONCE on initial submission
  const isFirstSubmission = !existingSeller?.onboardingStatus || existingSeller.onboardingStatus === "INCOMPLETE";
  if (isFirstSubmission) {
    const recipientEmail = existingSeller?.email || onboarding?.signatoryEmail || data.signatoryEmail || process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";
    const recipientName = data.businessName || existingSeller?.businessName || onboarding?.signatoryName || "Partner";

    sendSellerWaitlistEmail({
      to: recipientEmail,
      sellerName: recipientName,
    }).catch((err) => console.error("Failed to send Application Under Review email via Resend:", err));
  }

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
  
  if (!onboarding || onboarding.completedSteps < 5) {
    res.status(400).json({ error: "Steps 1 to 5 must be completed before submission" });
    return;
  }

  const result = await onboardingService.submitOnboarding(sellerId);
  res.json({ 
    message: "Application submitted successfully",
    applicationId: result.applicationId,
    status: "SUBMITTED"
  });
});

export const validateDomain = asyncHandler(async (req: Request, res: Response) => {
  const { url: inputUrl } = req.body;
  if (!inputUrl || typeof inputUrl !== "string" || !inputUrl.trim()) {
    res.status(400).json({ valid: false, message: "URL or domain is required" });
    return;
  }

  const raw = inputUrl.trim();
  let suggestion: string | null = null;

  // 1. Check for protocol typos (e.g. htps://, htp://, https//, http//, http:/)
  let workingUrl = raw;
  if (/^ht{1,2}ps?:\/\/?/i.test(workingUrl) && !/^https?:\/\//i.test(workingUrl)) {
    workingUrl = workingUrl.replace(/^ht{1,2}ps?:\/\/?/i, "https://");
    suggestion = workingUrl;
  } else if (/^ht{1,2}ps?\/\//i.test(workingUrl)) {
    workingUrl = workingUrl.replace(/^ht{1,2}ps?\/\//i, "https://");
    suggestion = workingUrl;
  }

  // 2. Check for comma typos (e.g. brand,com -> brand.com)
  if (workingUrl.includes(",com") || workingUrl.includes(",in") || workingUrl.includes(",org") || workingUrl.includes(",net")) {
    workingUrl = workingUrl.replace(/,(com|in|org|net|co)/gi, ".$1");
    suggestion = workingUrl;
  }

  // 3. Normalize with https:// for URL parsing
  let normalized = workingUrl;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = "https://" + normalized;
  }

  let hostname = "";
  try {
    const u = new URL(normalized);
    hostname = u.hostname.toLowerCase();
  } catch {
    res.json({
      valid: false,
      hasTypo: false,
      message: "Invalid URL or domain format",
    });
    return;
  }

  // 4. Common TLD and domain typos
  const tldTypos: Record<string, string> = {
    ".con": ".com",
    ".cpm": ".com",
    ".comm": ".com",
    ".coom": ".com",
    ".c0m": ".com",
    ".cm": ".com",
    ".cmo": ".com",
    ".xom": ".com",
    ".vom": ".com",
    ".inn": ".in",
    ".im": ".in",
    ".og": ".org",
    ".orgg": ".org",
    ".nt": ".net",
    ".nett": ".net",
    ".co.inn": ".co.in",
  };

  for (const [bad, good] of Object.entries(tldTypos)) {
    if (hostname.endsWith(bad)) {
      const fixedHost = hostname.slice(0, -bad.length) + good;
      suggestion = raw.replace(new RegExp(bad.replace(".", "\\.") + "(\\b|/|$)", "i"), good + "$1");
      if (!/^https?:\/\//i.test(suggestion)) {
        suggestion = "https://" + suggestion.replace(/^https?:\/\//i, "");
      }
      hostname = fixedHost;
      break;
    }
  }

  // If a typo was found, suggest it immediately
  if (suggestion && suggestion.toLowerCase() !== raw.toLowerCase()) {
    if (!/^https?:\/\//i.test(suggestion)) {
      suggestion = "https://" + suggestion;
    }
    res.json({
      valid: false,
      hasTypo: true,
      suggestion,
      hostname,
      message: `Possible typo detected. Did you mean ${suggestion}?`,
    });
    return;
  }

  // 5. Social media platform check
  const isSocial = /^(www\.)?(instagram\.com|facebook\.com|fb\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|pinterest\.com|tiktok\.com)$/i.test(hostname);
  if (isSocial) {
    res.json({
      valid: true,
      reachable: true,
      isSocial: true,
      hostname,
      normalizedUrl: normalized,
      message: "Valid social media profile link",
    });
    return;
  }

  // 6. Domain structure check (must have valid extension)
  if (!hostname.includes(".") || hostname.endsWith(".") || hostname.startsWith(".")) {
    res.json({
      valid: false,
      hasTypo: false,
      message: "Domain must include a valid extension (e.g. .com, .in, .co)",
    });
    return;
  }

  // 7. Check for spaces or invalid characters
  if (/\s/.test(hostname) || !/^[a-z0-9.-]+$/i.test(hostname)) {
    res.json({
      valid: false,
      hasTypo: false,
      message: "Domain contains invalid characters or spaces",
    });
    return;
  }

  // 8. DNS lookup check with 2.5s timeout
  try {
    const lookupPromise = dns.lookup(hostname);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DNS_TIMEOUT")), 2500)
    );

    const addresses: any = await Promise.race([lookupPromise, timeoutPromise]);
    res.json({
      valid: true,
      reachable: true,
      hostname,
      ip: addresses?.address || undefined,
      normalizedUrl: normalized,
      message: "Domain is live & active",
    });
  } catch (err: any) {
    if (err.code === "ENOTFOUND" || err.code === "EREFUSED") {
      res.json({
        valid: false,
        reachable: false,
        hostname,
        message: `Domain "${hostname}" does not exist or has no active DNS records. Please check spelling.`,
      });
    } else {
      // Timeout or other network quirks: don't strictly block seller if network is temporarily slow
      res.json({
        valid: true,
        reachable: null,
        hostname,
        normalizedUrl: normalized,
        message: "Domain format looks valid",
      });
    }
  }
});
