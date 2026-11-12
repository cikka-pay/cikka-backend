import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";

export const listUserVouchers = asyncHandler(async (req: Request, res: Response) => {
  const authUserId = (req as any).user?.id;
  const queryPhone = req.query.phone as string | undefined;

  let resolvedUserId = authUserId;
  if (!resolvedUserId && queryPhone) {
    const cleanPhone = String(queryPhone).replace(/\D/g, "").slice(-10);
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: { contains: cleanPhone } },
          { phone: cleanPhone },
          { phone: `+91${cleanPhone}` },
        ],
      },
    });
    if (user) resolvedUserId = user.id;
  }

  let dbVouchers: any[] = [];
  if (resolvedUserId) {
    dbVouchers = await prisma.userVoucher.findMany({
      where: { userId: resolvedUserId },
      orderBy: { createdAt: "desc" },
    });
  }

  // Reward Store policy: coupons never expire — normalize validTill & legacy EXPIRED rows.
  const vouchers = dbVouchers.map((v) => ({
    ...v,
    validTill: null,
    neverExpires: true,
    status: v.status === "EXPIRED" ? "ACTIVE" : v.status,
  }));

  // Compute brand groupings
  const brandMap = new Map<string, {
    brandTitle: string;
    brandLogo?: string | null;
    brandCategory?: string | null;
    voucherCount: number;
    activeCount: number;
    totalValue: number;
    activeValue: number;
    vouchers: any[];
  }>();

  let totalActiveCount = 0;
  let totalActiveValue = 0;
  let totalRedeemedCount = 0;

  for (const v of vouchers) {
    const isActive = v.status === "ACTIVE";
    const denom = Number(v.denomination) || 0;

    if (isActive) {
      totalActiveCount++;
      totalActiveValue += denom;
    } else {
      totalRedeemedCount++;
    }

    const key = v.brandTitle || "Brand Voucher";
    if (!brandMap.has(key)) {
      brandMap.set(key, {
        brandTitle: key,
        brandLogo: v.brandLogo,
        brandCategory: v.brandCategory,
        voucherCount: 0,
        activeCount: 0,
        totalValue: 0,
        activeValue: 0,
        vouchers: [],
      });
    }

    const entry = brandMap.get(key)!;
    entry.voucherCount++;
    entry.totalValue += denom;
    if (isActive) {
      entry.activeCount++;
      entry.activeValue += denom;
    }
    entry.vouchers.push(v);
  }

  const brandGroups = Array.from(brandMap.values()).sort((a, b) => b.activeCount - a.activeCount);

  res.status(200).json({
    success: true,
    totalCount: vouchers.length,
    totalActiveCount,
    totalActiveValue,
    totalRedeemedCount,
    vouchers,
    brandGroups,
  });
});

export const getVoucherById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const voucher = await prisma.userVoucher.findFirst({
    where: {
      OR: [{ id }, { orderReference: id }],
    },
  });

  if (!voucher) {
    res.status(404).json({ success: false, error: "Voucher not found" });
    return;
  }

  res.status(200).json({
    success: true,
    voucher: {
      ...voucher,
      validTill: null,
      neverExpires: true,
      status: voucher.status === "EXPIRED" ? "ACTIVE" : voucher.status,
    },
  });
});

export const updateVoucherStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !["ACTIVE", "REDEEMED"].includes(status)) {
    res.status(400).json({ success: false, error: "Valid status required: ACTIVE or REDEEMED" });
    return;
  }

  const existing = await prisma.userVoucher.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ success: false, error: "Voucher not found" });
    return;
  }

  const updated = await prisma.userVoucher.update({
    where: { id },
    data: {
      status: status as any,
      validTill: null,
      redeemedAt: status === "REDEEMED" ? new Date() : null,
    },
  });

  res.status(200).json({
    success: true,
    message: `Voucher marked as ${status}`,
    voucher: {
      ...updated,
      validTill: null,
      neverExpires: true,
    },
  });
});

