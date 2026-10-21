import { Router } from "express";
import {
  getSavedCardsHandler,
  saveCardTokenHandler,
  deleteCardTokenHandler,
} from "../controllers/cards.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

router.use(optionalUserAuth);

// GET saved tokenized cards
router.get("/saved", getSavedCardsHandler);
router.get("/", getSavedCardsHandler);

// POST tokenize & save card
router.post("/save", saveCardTokenHandler);
router.post("/tokenize", saveCardTokenHandler);

// DELETE revoke token
router.delete("/:id", deleteCardTokenHandler);

export default router;
