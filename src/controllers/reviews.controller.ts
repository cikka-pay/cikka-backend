import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * GET /api/products/:id/reviews
 * Fetch customer ratings & reviews for a product with breakdown metrics
 */
export const getProductReviews = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { filter, page = "1", limit = "50" } = req.query as any;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 50;
  const skip = (pageNum - 1) * limitNum;

  // Resolve target product by id or sku
  const product = await prisma.product.findFirst({
    where: {
      OR: [{ id }, { sku: id }],
    },
    select: { id: true, name: true },
  });

  if (!product) {
    res.status(404).json({ success: false, error: "Product not found" });
    return;
  }

  const productId = product.id;

  // Build filter condition
  const where: any = { productId };
  if (filter === "5" || filter === "4" || filter === "3" || filter === "2" || filter === "1") {
    where.rating = parseInt(filter, 10);
  } else if (filter === "photos") {
    where.photos = { isEmpty: false };
  }

  const [reviews, totalCount, allRatings] = await Promise.all([
    prisma.productReview.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
    }),
    prisma.productReview.count({ where }),
    prisma.productReview.findMany({
      where: { productId },
      select: { rating: true, photos: true },
    }),
  ]);

  // Aggregate metrics
  const totalReviews = allRatings.length;
  let avgRating = 4.9; // Base benchmark if no user reviews yet
  let fiveStarCount = 0;
  let fourStarCount = 0;
  let threeStarCount = 0;
  let twoStarCount = 0;
  let oneStarCount = 0;
  let photosCount = 0;

  if (totalReviews > 0) {
    let sum = 0;
    allRatings.forEach((r) => {
      sum += r.rating;
      if (r.rating === 5) fiveStarCount++;
      else if (r.rating === 4) fourStarCount++;
      else if (r.rating === 3) threeStarCount++;
      else if (r.rating === 2) twoStarCount++;
      else if (r.rating === 1) oneStarCount++;

      if (Array.isArray(r.photos) && r.photos.length > 0) {
        photosCount++;
      }
    });
    avgRating = parseFloat((sum / totalReviews).toFixed(1));
  }

  res.status(200).json({
    success: true,
    data: {
      reviews: reviews.map((r) => ({
        id: r.id,
        name: r.userName || "Verified Buyer",
        verified: r.verified,
        date: r.createdAt.toISOString(),
        dateFormatted: r.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        rating: r.rating,
        title: r.title || "",
        comment: r.comment,
        helpfulYes: r.helpfulYes,
        helpfulNo: r.helpfulNo,
        hasPhoto: Array.isArray(r.photos) && r.photos.length > 0,
        photos: r.photos || [],
        videoUrl: r.videoUrl || null,
      })),
      metrics: {
        totalReviews,
        avgRating,
        breakdown: {
          5: fiveStarCount,
          4: fourStarCount,
          3: threeStarCount,
          2: twoStarCount,
          1: oneStarCount,
        },
        photosCount,
      },
    },
  });
});

/**
 * POST /api/products/:id/reviews
 * Submit a customer rating & review (with optional photos and video)
 */
export const createProductReview = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id || null;
  const userPhone = (req.user as any)?.phone || null;

  const { rating, title, comment, photos = [], videoUrl, name } = req.body;

  if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
    res.status(400).json({ success: false, error: "Rating must be an integer between 1 and 5" });
    return;
  }

  if (!comment || typeof comment !== "string" || comment.trim().length < 5) {
    res.status(400).json({ success: false, error: "Review comment must be at least 5 characters" });
    return;
  }

  const product = await prisma.product.findFirst({
    where: {
      OR: [{ id }, { sku: id }],
    },
  });

  if (!product) {
    res.status(404).json({ success: false, error: "Product not found" });
    return;
  }

  const reviewerName = name || (userId ? `Cikka Member` : "Verified Buyer");

  const newReview = await prisma.productReview.create({
    data: {
      productId: product.id,
      userId,
      userName: reviewerName,
      userPhone,
      rating: Math.round(rating),
      title: title ? String(title).trim() : null,
      comment: String(comment).trim(),
      photos: Array.isArray(photos) ? photos.filter((u: any) => typeof u === "string" && u.trim().length > 0) : [],
      videoUrl: videoUrl ? String(videoUrl).trim() : null,
      verified: true,
      helpfulYes: 0,
      helpfulNo: 0,
    },
  });

  res.status(201).json({
    success: true,
    message: "Thank you! Your verified review has been published.",
    review: newReview,
  });
});

/**
 * POST /api/products/:id/reviews/:reviewId/vote
 * Upvote / Downvote a review as helpful
 */
export const voteReview = asyncHandler(async (req: Request, res: Response) => {
  const { reviewId } = req.params;
  const { type = "yes" } = req.body;

  const review = await prisma.productReview.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    res.status(404).json({ success: false, error: "Review not found" });
    return;
  }

  const updated = await prisma.productReview.update({
    where: { id: reviewId },
    data: {
      ...(type === "yes" ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } }),
    },
  });

  res.status(200).json({
    success: true,
    helpfulYes: updated.helpfulYes,
    helpfulNo: updated.helpfulNo,
  });
});
