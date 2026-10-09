import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, ReturnStatus } from "../generated/prisma/client";

export const listReturns = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { page = "1", limit = "10", status } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.ReturnWhereInput = { order: { sellerId } };

  if (status && status !== "ALL") {
    where.status = status as ReturnStatus;
  }

  const [data, total] = await Promise.all([
    prisma.return.findMany({
      where,
      skip,
      take: limitNum,
      include: { order: true, product: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.return.count({ where }),
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

export const updateReturnStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const sellerId = req.seller!.id;
  const { status } = req.body;

  const ret = await prisma.return.findFirst({
    where: { id, order: { sellerId } },
  });

  if (!ret) {
    res.status(404).json({ error: "Return not found" });
    return;
  }

  const updatedReturn = await prisma.return.update({
    where: { id },
    data: { status },
  });

  res.json(updatedReturn);
});
