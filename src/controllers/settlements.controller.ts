import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, SettlementStatus } from "@prisma/client";

export const listSettlements = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { page = "1", limit = "10", status } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.SettlementWhereInput = { sellerId };

  if (status && status !== "ALL") {
    where.status = status as SettlementStatus;
  }

  const [data, total] = await Promise.all([
    prisma.settlement.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { periodStart: "desc" },
    }),
    prisma.settlement.count({ where }),
  ]);

  res.json({
    data,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});
