import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, SettlementStatus } from "@prisma/client";
import { calculateSettlementBreakdown } from "../services/settlementCalculator.service";

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

  const breakdown = calculateSettlementBreakdown(numAmount);
  const now = new Date();
  const holdUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const utr = `IMPS-${Math.floor(100000000000 + Math.random() * 900000000000)}`;

  const settlement = await prisma.settlement.create({
    data: {
      sellerId,
      periodStart: now,
      periodEnd: now,
      category: "Withdrawal",
      grossSales: breakdown.grossProductValue,
      basePrice: breakdown.baseProductValue,
      gstOnSale: breakdown.productGst,
      commissionRate: breakdown.commissionRate,
      commissionAmount: breakdown.commission,
      gstOnCommission: breakdown.commissionGst,
      commissionTotal: breakdown.commissionTotal,
      shippingFee: breakdown.shipping,
      shippingGst: breakdown.shippingGst,
      shippingTotal: breakdown.shippingTotal,
      sellerPlatformFee: breakdown.sellerPlatformFee,
      sellerPlatformFeeGst: breakdown.sellerPlatformFeeGst,
      sellerPlatformTotal: breakdown.sellerPlatformTotal,
      tdsAmount: breakdown.tds,
      tcsAmount: breakdown.tcs,
      statutoryTaxes: breakdown.tds + breakdown.tcs,
      successFeeAmount: breakdown.successFee,
      successFeeGst: breakdown.successFeeGst,
      successFeeTotal: breakdown.successFeeTotal,
      customerPlatformFee: breakdown.customerPlatformFee,
      customerPlatformFeeGst: breakdown.customerPlatformFeeGst,
      customerPlatformTotal: breakdown.customerPlatformTotal,
      customerTotalPayment: breakdown.customerTotalPayment,
      cikkaFeeRevenue: breakdown.cikkaFeeRevenue,
      cikkaGstCollected: breakdown.cikkaGstCollected,
      totalDeductions: breakdown.totalSellerDeductions,
      shippingGstAmount: breakdown.totalSellerDeductions,
      netPayable: breakdown.sellerNetSettlement,
      status: "PAID",
      payoutDate: now,
      holdUntil,
      transferStatus: "SETTLED",
      utr,
      disbursedAt: now,
      ledgerBreakdown: breakdown as any,
    } as any,
  });

  res.json({
    success: true,
    data: settlement,
    breakdown,
    utr,
  });
});

