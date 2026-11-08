import { Request, Response } from "express";
import { savedCardsService, SavedCardError } from "../services/razorpayToken.service";
import { asyncHandler } from "../utils/asyncHandler";

function cardView(c: {
  id: string;
  razorpayTokenId: string;
  bankName: string;
  cardNetwork: string;
  cardType: string;
  last4: string;
  cardholderName: string | null;
  expiryMonth: string | null;
  expiryYear: string | null;
  isDefault: boolean;
  status: string;
}) {
  return {
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
  };
}

function sendCardError(res: Response, err: unknown): boolean {
  if (err instanceof SavedCardError) {
    res.status(err.status).json({ success: false, code: err.code, error: err.message });
    return true;
  }
  return false;
}

/**
 * GET /api/cards/saved
 * The signed-in user's saved cards = tokens of their Razorpay customer (refreshes the cache).
 * `customer_id` is what the app passes to Razorpay Checkout to show / save cards.
 */
export const getSavedCardsHandler = asyncHandler(async (req: Request, res: Response) => {
  try {
    const cards = await savedCardsService.listCards(req.user!.id);
    const customerId = await savedCardsService.customerIdFor(req.user!.id);
    res.status(200).json({ success: true, customer_id: customerId, cards: cards.map(cardView) });
  } catch (err) {
    if (sendCardError(res, err)) return;
    throw err;
  }
});

/**
 * POST /api/cards/save, POST /api/cards/tokenize
 * Retired: we no longer accept card details. Cards are saved by Razorpay Checkout (the user
 * ticks "save card" while paying with the `customer_id` from create-order / GET /cards/saved).
 */
export const saveCardTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const customerId = await savedCardsService.customerIdFor(req.user!.id);
  res.status(410).json({
    success: false,
    code: "CARD_SAVE_IN_CHECKOUT",
    error: "Cards are saved securely in Razorpay Checkout while paying. Card details are not accepted here.",
    customer_id: customerId,
  });
});

/**
 * DELETE /api/cards/:id  (our card id or the Razorpay token id)
 * Deletes the token from the user's own Razorpay customer and revokes the cached card.
 */
export const deleteCardTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  try {
    const revoked = await savedCardsService.deleteCard(req.user!.id, req.params.id);
    if (!revoked) {
      res.status(404).json({ success: false, error: "Card not found" });
      return;
    }
    res.status(200).json({ success: true, message: "Card removed" });
  } catch (err) {
    if (sendCardError(res, err)) return;
    throw err;
  }
});
