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

export const createWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { amount } = req.body;

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    res.status(400).json({ message: "Invalid withdrawal amount" });
    return;
  }

  const commRate = 21.0;
  const ship = 150.0;
  const commFrac = commRate / 100;
  // Net Factor = 1 - TDS_gross (0.001) - (1.18*comm + TCS_base (0.005)) / 1.18
  const commAndTcsDeductionFrac = (1.18 * commFrac + 0.005) / 1.18;
  const netFactor = 1 - 0.001 - commAndTcsDeductionFrac; // ~0.78476
  const grossSales = (numAmount + ship) / netFactor;
  const basePrice = grossSales / 1.18;
  const gstOnSale = grossSales - basePrice;
  const comm = basePrice * commFrac;
  const gstOnComm = comm * 0.18;
  const tdsAmount = grossSales * 0.001; // 0.1% TDS on Gross
  const tcsAmount = basePrice * 0.005;  // 0.5% TCS on Net Taxable Base Price
  const tax = tdsAmount + tcsAmount;
  const shippingGstAmount = gstOnComm + ship + tax;

  const now = new Date();
  const utr = `IMPS-${Math.floor(100000000000 + Math.random() * 900000000000)}`;
  const settlement = await prisma.settlement.create({
    data: {
      sellerId,
      periodStart: now,
      periodEnd: now,
      category: "Cosmetics",
      grossSales,
      basePrice,
      gstOnSale,
      commissionRate: commRate,
      commissionAmount: comm,
      gstOnCommission: gstOnComm,
      shippingFee: ship,
      tdsAmount,
      tcsAmount,
      statutoryTaxes: tax,
      shippingGstAmount,
      netPayable: numAmount,
      status: "PAID",
      payoutDate: now,
      decentroTxnId: `SET_WTH_${Date.now()}`,
      utr,
      disbursedAt: now,
    } as any,
  });

  res.json({
    success: true,
    data: settlement,
    utr,
  });
});
