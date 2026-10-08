import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSellerWaitlistEmail, sendSellerWelcomeEmail } from "../utils/resend";

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

  const recipientEmail = email || process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";

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

  if (!email || email.includes("@cikka.club") || email.trim() === "") {
    if (sellerId) {
      const seller = await prisma.seller.findUnique({
        where: { id: sellerId },
        include: { onboarding: true },
      });
      email = seller?.email || seller?.onboarding?.signatoryEmail;
    }
  }

  const recipientEmail = email || process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";

  const result = await sendSellerWelcomeEmail({
    to: recipientEmail,
    sellerName: sellerName || businessName || "Partner",
  });

  if (!result.success) {
    res.status(500).json({ error: result.error || "Failed to send welcome email" });
    return;
  }

  res.json({ message: "Welcome email dispatched successfully", id: result.id, recipient: recipientEmail });
});

