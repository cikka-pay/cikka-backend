import { Router } from "express";
import {
  getSavedCardsHandler,
  saveCardTokenHandler,
  deleteCardTokenHandler,
} from "../controllers/cards.controller";
import { requireUserAuth } from "../middleware/auth.middleware";

const router = Router();

// Saved cards are personal: a signed-in mobile user is required and only their cards are visible.
router.use(requireUserAuth);

// GET saved tokenized cards
router.get("/saved", getSavedCardsHandler);
router.get("/", getSavedCardsHandler);

// POST tokenize & save card
router.post("/save", saveCardTokenHandler);
router.post("/tokenize", saveCardTokenHandler);

// DELETE revoke token
router.delete("/:id", deleteCardTokenHandler);

export default router;
