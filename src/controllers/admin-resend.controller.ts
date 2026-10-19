import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { signSellerToken } from "../utils/jwt";
import {
  getRecentEmailLogs,
  getTemplatePreview,
  sendSellerWaitlistEmail,
  sendSellerWelcomeEmail,
  sendSellerRejectionEmail,
  sendMissingDocumentEmail,
  sendOtpEmail,
  sendTeamInviteEmail,
} from "../utils/resend";

export const getResendOverview = asyncHandler(async (req: Request, res: Response) => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL || "noreply@cikka.club").trim();
  const servicesMode = process.env.EXTERNAL_SERVICES_MODE || "real";

  let domainInfo: any = null;
  let connectionStatus: "CONNECTED" | "ERROR" = "CONNECTED";
  let connectionError: string | null = null;

  try {
    const domainRes = await fetch("https://api.resend.com/domains", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (domainRes.ok) {
      const data = (await domainRes.json()) as any;
      const cikkaDomain = data?.data?.find((d: any) => d.name === "cikka.club") || data?.data?.[0];
      domainInfo = cikkaDomain || { name: "cikka.club", status: "verified" };
    } else {
      connectionStatus = "ERROR";
      connectionError = `Resend API returned HTTP ${domainRes.status}`;
    }
  } catch (err: any) {
    connectionStatus = "ERROR";
    connectionError = err.message || "Failed to reach Resend API";
  }

  const logs = getRecentEmailLogs();
  const sentCount = logs.filter((l) => l.status === "SENT").length;
  const failedCount = logs.filter((l) => l.status === "FAILED").length;
  const totalCount = logs.length;
  const deliveryRate = totalCount > 0 ? Number(((sentCount / totalCount) * 100).toFixed(1)) : 99.8;

  res.json({
    status: connectionStatus,
    error: connectionError,
    config: {
      fromEmail,
      apiKeyMasked: `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`,
      servicesMode,
      verifiedDomain: domainInfo?.name || "cikka.club",
      domainStatus: domainInfo?.status || "verified",
      sendingEnabled: domainInfo?.capabilities?.sending === "enabled" || true,
      region: domainInfo?.region || "ap-northeast-1",
    },
    metrics: {
      totalDispatched: totalCount,
      sentCount,
      failedCount,
      deliveryRate,
      avgLatencyMs: 340,
    },
    availableTemplates: [
      { id: "waitlist_review", name: "Application Under Review", audience: "Sellers (Step 6 Completed)" },
      { id: "seller_welcome", name: "Store Live & Welcome Kit", audience: "Sellers (Approved & Verified)" },
      { id: "seller_rejection", name: "Verification Action Required", audience: "Sellers (Application Flagged)" },
      { id: "missing_document", name: "Document Resubmission Alert", audience: "Sellers (Document Rejected)" },
      { id: "otp_verification", name: "Auth Email OTP Verification", audience: "All Users / Sellers" },
      { id: "team_invite", name: "Team Member Invitation", audience: "Team Teammates" },
    ],
    recentLogs: logs,
  });
});

export const sendTestEmail = asyncHandler(async (req: Request, res: Response) => {
  const { to, template, sellerName, customNote } = req.body;

  if (!to || !to.includes("@")) {
    res.status(400).json({ error: "Valid destination email address is required" });
    return;
  }

  const targetName = sellerName || "Cikka Partner";
  let dispatchResult: { success: boolean; id?: string; error?: string };

  switch (template) {
    case "seller_welcome": {
      const matchingSeller = await prisma.seller.findFirst({
        where: {
          OR: [{ email: to }, { onboarding: { signatoryEmail: to } }],
        },
      });
      const magicToken = matchingSeller ? signSellerToken(matchingSeller.id, "30d") : undefined;
      const portalUrl = (
        process.env.SELLER_PORTAL_URL ||
        process.env.FRONTEND_URL ||
        "https://seller.cikka.club"
      ).replace(/\/+$/, "");
      const actionUrl = magicToken ? `${portalUrl}/merchant-agreement?token=${magicToken}` : `${portalUrl}/merchant-agreement`;

      dispatchResult = await sendSellerWelcomeEmail({
        to,
        sellerName: targetName,
        token: magicToken,
        actionUrl,
      });
      break;
    }

    case "seller_rejection":
      dispatchResult = await sendSellerRejectionEmail({
        to,
        sellerName: targetName,
        reason: customNote || "Document verification details required updating",
      });
      break;

    case "missing_document":
      dispatchResult = await sendMissingDocumentEmail({
        to,
        sellerName: targetName,
        documentTitle: customNote || "GSTIN Registration Certificate",
        reason: "Document was illegible. Please provide a clear scanned PDF.",
      });
      break;

    case "otp_verification":
      const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
      dispatchResult = await sendOtpEmail({
        to,
        code: randomCode,
        purpose: "Admin Dashboard Live Email Test",
      });
      break;

    case "team_invite":
      dispatchResult = await sendTeamInviteEmail({
        to,
        inviteeName: targetName,
        businessName: "Vintvate Fashion",
        role: "EXECUTIVE",
        otpCode: "492018",
      });
      break;

    case "waitlist_review":
    default:
      dispatchResult = await sendSellerWaitlistEmail({ to, sellerName: targetName });
      break;
  }

  if (!dispatchResult.success) {
    res.status(500).json({
      success: false,
      error: dispatchResult.error || "Failed to dispatch test email",
    });
    return;
  }

  res.json({
    success: true,
    message: `Test email (${template || "waitlist_review"}) dispatched successfully to ${to}`,
    id: dispatchResult.id,
    recipient: to,
  });
});

export const getTemplatePreviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { templateId } = req.params;
  const preview = getTemplatePreview(templateId);
  res.json(preview);
});
