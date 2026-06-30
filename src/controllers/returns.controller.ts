import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const listReturns = asyncHandler(async (req, res) => {
  const returns = await prisma.return.findMany({
    where: { order: { sellerId: req.seller.id } },
    include: { order: true, product: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(returns);
});
