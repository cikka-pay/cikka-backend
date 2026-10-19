import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSellerWaitlistEmail, sendSellerWelcomeEmail } from "../utils/resend";
import { signSellerToken } from "../utils/jwt";

export const sendWaitlistEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  let { email, sellerName, businessName } = req.body;
  const sellerId = req.seller?.id;

  // Resolve target email from DB if not explicitly provided or if default placeholder
  if (!email || email.includes("@cikka.club") || email.trim() === "") {
    if (sellerId) {
      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { onboarding: true },
      });
      email = seller?.email || seller?.onboarding?.signatoryEmail;
    }
  }

  const recipientEmail = email?.trim();
  if (!recipientEmail || !recipientEmail.includes("@")) {
    res.status(400).json({ error: "Valid recipient email address is required" });
    return;
  }

  const result = await sendSellerWaitlistEmail({
    to: recipientEmail,
    sellerName: sellerName || businessName || "Partner",
  });

  if (!result.success) {
    res.status(500).json({ error: result.error || "Failed to send waitlist email" });
    return;
  }

  res.json({ message: "Waitlist email dispatched successfully", id: result.id, recipient: recipientEmail });
});

export const sendWelcomeEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  let { email, sellerName, businessName } = req.body;
  const sellerId = req.seller?.id;

  if (!email || email.trim() === "") {
    if (sellerId) {
      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { onboarding: true },
      });
      email = seller?.email || seller?.onboarding?.signatoryEmail;
    }
  }

  const recipientEmail = email?.trim();
  if (!recipientEmail || !recipientEmail.includes("@")) {
    res.status(400).json({ error: "Valid recipient email address is required" });
    return;
  }

  let magicToken: string | undefined;
  if (sellerId) {
    magicToken = signSellerToken(sellerId, "30d");
  } else {
    const matchingSeller = await prisma.seller.findFirst({
      where: {
        OR: [{ email: recipientEmail }, { onboarding: { signatoryEmail: recipientEmail } }],
      },
    });
    if (matchingSeller) {
      magicToken = signSellerToken(matchingSeller.id, "30d");
    }
  }

  const portalUrl = (
    process.env.SELLER_PORTAL_URL ||
    process.env.FRONTEND_URL ||
    "https://seller.cikka.club"
  ).replace(/\/+$/, "");
  const actionUrl = magicToken ? `${portalUrl}/merchant-agreement?token=${magicToken}` : `${portalUrl}/merchant-agreement`;

  const result = await sendSellerWelcomeEmail({
    to: recipientEmail,
    sellerName: sellerName || businessName || "Partner",
    token: magicToken,
    actionUrl,
  });

  if (!result.success) {
    res.status(500).json({ error: result.error || "Failed to send welcome email" });
    return;
  }

  res.json({ message: "Welcome email dispatched successfully", id: result.id, recipient: recipientEmail });
});

