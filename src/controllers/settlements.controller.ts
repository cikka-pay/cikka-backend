import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const listSettlements = asyncHandler(async (req, res) => {
  const settlements = await prisma.settlement.findMany({
    where: { sellerId: req.seller.id },
    orderBy: { periodStart: "desc" },
  });
  res.json(settlements);
});
