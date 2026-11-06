import { Request, Response } from "express";
import { razorpayTokenService } from "../services/razorpayToken.service";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * GET /api/cards/saved
 * Fetch all active saved tokenized credit cards for the user (RBI CoF compliant)
 */
export const getSavedCardsHandler = asyncHandler(async (req: Request, res: Response) => {
  // Only the signed-in user's cards; phone/userId query params are no longer honoured.
  const cards = await razorpayTokenService.getSavedCards(req.user!.id);

  res.status(200).json({
    success: true,
    cards: cards.map((c) => ({
      id: c.id,
      tokenId: c.razorpayTokenId,
      bankName: c.bankName,
      cardNetwork: c.cardNetwork,
      cardType: c.cardType,
      last4: c.last4,
      cardholderName: c.cardholderName,
      expiryMonth: c.expiryMonth,
      expiryYear: c.expiryYear,
      isDefault: c.isDefault,
      status: c.status,
    })),
  });
});

/**
 * POST /api/cards/save
 * POST /api/cards/tokenize
 * Tokenize newly added card and store token (RBI compliant - zero PAN stored)
 */
export const saveCardTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const {
    bankName,
    cardNetwork,
    cardType = "credit",
    last4,
    cardholderName,
    expiryMonth,
    expiryYear,
    isDefault = false,
  } = req.body;

  if (!last4 || String(last4).length < 4) {
    res.status(400).json({
      success: false,
      error: "Last 4 digits of card are required for tokenization record",
    });
    return;
  }
  if (!bankName || !cardNetwork) {
    res.status(400).json({ success: false, error: "bankName and cardNetwork are required" });
    return;
  }

  const savedCard = await razorpayTokenService.saveCardToken({
    userId: req.user!.id,
    bankName,
    cardNetwork,
    cardType,
    last4: String(last4).slice(-4),
    cardholderName,
    expiryMonth,
    expiryYear,
    isDefault,
  });

  res.status(201).json({
    success: true,
    message: "Card securely tokenized as per RBI guidelines",
    card: {
      id: savedCard.id,
      tokenId: savedCard.razorpayTokenId,
      bankName: savedCard.bankName,
      cardNetwork: savedCard.cardNetwork,
      cardType: savedCard.cardType,
      last4: savedCard.last4,
      isDefault: savedCard.isDefault,
    },
  });
});

/**
 * DELETE /api/cards/:id
 * Revoke and remove saved card token
 */
export const deleteCardTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const revoked = await razorpayTokenService.deleteCardToken(id, req.user!.id);
  if (!revoked) {
    res.status(404).json({ success: false, error: "Card not found" });
    return;
  }

  res.status(200).json({
    success: true,
    message: "Card token revoked successfully",
  });
});
