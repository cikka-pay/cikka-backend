import { Router } from "express";
import {
  getProductReviews,
  createProductReview,
  voteReview,
} from "../controllers/reviews.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

// GET reviews for a product
router.get("/", optionalUserAuth, getProductReviews);
router.get("/:id", optionalUserAuth, getProductReviews);

// POST new review for a product
router.post("/", optionalUserAuth, createProductReview);
router.post("/:id", optionalUserAuth, createProductReview);

// Vote on a review (helpful yes / no)
router.post("/:reviewId/vote", optionalUserAuth, voteReview);

export default router;
