import { prisma } from "../config/prisma";
import { calculateSettlementBreakdown, SettlementFeeConfig } from "./settlementCalculator.service";

// Monday 00:00:00 of the week containing `date`.
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function sumOrderTotals(sellerId: string, from: Date, to: Date): Promise<number> {
  const result = await prisma.order.aggregate({
    where: { sellerId, createdAt: { gte: from, lt: to } },
    _sum: { totalAmount: true },
  });
  return Number(result._sum.totalAmount || 0);
}

export async function getSummary(sellerId: string, role: string = "ADMIN") {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const [netPayoutAgg, ordersCountThisWeek, grossSalesThisWeek, grossSalesLastWeek, activeOrdersToPack, products, nextSettlement, commissionConfig, onboarding] =
    await Promise.all([
      prisma.settlement.aggregate({
        where: { sellerId, status: "PENDING" },
        _sum: { netPayable: true },
      }),
      prisma.order.count({ where: { sellerId, createdAt: { gte: weekStart, lt: now } } }),
      sumOrderTotals(sellerId, weekStart, now),
      sumOrderTotals(sellerId, lastWeekStart, weekStart),
      prisma.order.count({ where: { sellerId, status: "PENDING" } }),
      prisma.product.findMany({ where: { sellerId, status: "ACTIVE" } }),
      prisma.settlement.findFirst({
        where: { sellerId, status: "PENDING" },
        orderBy: { payoutDate: "asc" },
      }),
      prisma.sellerCommissionConfig.findUnique({ where: { sellerId } }),
      prisma.sellerOnboarding.findUnique({ where: { sellerId } }),
    ]);

  const lowStockCount = products.filter((p) => p.stockQty <= p.lowStockThreshold).length;

  const grossSalesChangePct =
    grossSalesLastWeek > 0
      ? ((grossSalesThisWeek - grossSalesLastWeek) / grossSalesLastWeek) * 100
      : null;

  const isAdmin = role.toUpperCase() === "ADMIN" || role.toUpperCase() === "OWNER";

  // Calculate Net Payout deterministically from live captured credit card orders or settlements
  let activeCategory = onboarding?.businessCategory;
  if (!activeCategory && onboarding?.productCategories) {
    if (Array.isArray(onboarding.productCategories) && onboarding.productCategories.length > 0) {
      activeCategory = onboarding.productCategories[0] as string;
    }
  }
  let commRate = 22.0;
  if (activeCategory && commissionConfig?.categoryCommissions) {
    const ratesMap = commissionConfig.categoryCommissions as Record<string, number>;
    if (ratesMap[activeCategory] !== undefined) {
      commRate = Number(ratesMap[activeCategory]);
    }
  }

  let netPayout = 0;
  if (grossSalesThisWeek > 0) {
    const breakdown = calculateSettlementBreakdown(
      grossSalesThisWeek,
      { commissionRate: commRate },
      Math.max(ordersCountThisWeek, 1)
    );
    netPayout = breakdown.sellerNetSettlement;
  } else {
    netPayout = Number(netPayoutAgg._sum.netPayable || 0);
  }

  return {
    netPayoutPending: isAdmin ? netPayout : null,
    isPayoutMasked: !isAdmin,
    grossSalesThisWeek,
    grossSalesChangePct,
    activeOrdersToPack,
    lowStockCount,
    settlementCycle: {
      type: "T+7",
      nextPayoutDate: nextSettlement?.payoutDate ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
  };
}

export async function getSettlementBreakdown(sellerId: string, period: "week" | "month", role: string = "ADMIN") {
  const now = new Date();
  const from = period === "month" ? startOfMonth(now) : startOfWeek(now);

  const [settlementResult, ordersGrossResult, ordersCount, orderItemsQuantityResult, latest, commissionConfig, onboarding] = await Promise.all([
    prisma.settlement.aggregate({
      where: {
        sellerId,
        OR: [
          { periodStart: { gte: from } },
          { status: "PENDING" },
        ],
      },
      _sum: {
        grossSales: true,
        commissionAmount: true,
        shippingGstAmount: true,
        netPayable: true,
      },
    }),
    prisma.order.aggregate({
      where: { sellerId, createdAt: { gte: from } },
      _sum: { totalAmount: true },
    }),
    prisma.order.count({
      where: { sellerId, createdAt: { gte: from } },
    }),
    prisma.orderItem.aggregate({
      where: { order: { sellerId, createdAt: { gte: from } } },
      _sum: { quantity: true },
    }),
    prisma.settlement.findFirst({
      where: {
        sellerId,
        OR: [
          { periodStart: { gte: from } },
          { status: "PENDING" },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sellerCommissionConfig.findUnique({ where: { sellerId } }),
    prisma.sellerOnboarding.findUnique({ where: { sellerId } }),
  ]);

  // Extract seller's active onboarding category
  let activeCategory = latest?.category || onboarding?.businessCategory;
  if (!activeCategory && onboarding?.productCategories) {
    if (Array.isArray(onboarding.productCategories) && onboarding.productCategories.length > 0) {
      activeCategory = onboarding.productCategories[0] as string;
    } else if (typeof onboarding.productCategories === "string") {
      try {
        const parsed = JSON.parse(onboarding.productCategories);
        if (Array.isArray(parsed) && parsed.length > 0) activeCategory = parsed[0];
      } catch {}
    }
  }
  if (!activeCategory && commissionConfig?.categoryCommissions) {
    const cats = Object.keys(commissionConfig.categoryCommissions as Record<string, number>);
    if (cats.length > 0) activeCategory = cats[0];
  }
  if (!activeCategory) activeCategory = "Fashion";

  // Determine dynamic commission rate
  let defaultRate = 22.0;
  if (commissionConfig?.categoryCommissions && typeof commissionConfig.categoryCommissions === "object") {
    const ratesMap = commissionConfig.categoryCommissions as Record<string, number>;
    if (ratesMap[activeCategory] !== undefined) {
      defaultRate = Number(ratesMap[activeCategory]);
    } else {
      const firstVal = Object.values(ratesMap)[0];
      if (firstVal !== undefined) defaultRate = Number(firstVal);
    }
  }

  const sums = (settlementResult?._sum || {}) as any;
  const settlementGross = Number(sums.grossSales || 0);
  const ordersGross = Number(ordersGrossResult?._sum?.totalAmount || 0);
  const commissionRate = Number(latest?.commissionRate ?? defaultRate);

  const itemsSold = Number(orderItemsQuantityResult?._sum?.quantity || 0);
  const totalProductsSold = ordersCount > 0 ? ordersCount : (itemsSold > 0 ? itemsSold : (settlementGross > 0 ? 3 : 0));
  const effectiveOrderCount = Math.max(totalProductsSold, 1);

  const isAdmin = role.toUpperCase() === "ADMIN" || role.toUpperCase() === "OWNER";

  // If live orders exist in this period, they are the primary source of truth for current sales
  if (ordersGross > 0) {
    const grossSales = ordersGross;
    const customConfig: Partial<SettlementFeeConfig> = {
      commissionRate,
    };
    if (commissionConfig?.flatOrderFee !== undefined) {
      customConfig.sellerPlatformFee = Number(commissionConfig.flatOrderFee);
    }

    const breakdown = calculateSettlementBreakdown(grossSales, customConfig, effectiveOrderCount);

    return {
      period,
      grossSales: breakdown.grossProductValue,
      productsCount: totalProductsSold,
      basePrice: breakdown.baseProductValue,
      gstOnSale: breakdown.productGst,
      commission: {
        category: activeCategory,
        rate: breakdown.commissionRate,
        amount: isAdmin ? breakdown.commission : null,
      },
      commissionAmount: isAdmin ? breakdown.commission : null,
      gstOnCommission: isAdmin ? breakdown.commissionGst : null,
      commissionTotal: isAdmin ? breakdown.commissionTotal : null,
      shippingFee: isAdmin ? breakdown.shipping : null,
      gstOnShipping: isAdmin ? breakdown.shippingGst : null,
      shippingTotal: isAdmin ? breakdown.shippingTotal : null,
      tdsAmount: isAdmin ? breakdown.tds : null,
      tcsAmount: isAdmin ? breakdown.tcs : null,
      statutoryTaxes: {
        total: isAdmin ? Number((breakdown.tds + breakdown.tcs).toFixed(2)) : null,
        tds: isAdmin ? breakdown.tds : null,
        tcs: isAdmin ? breakdown.tcs : null,
      },
      statutoryTaxAmount: isAdmin ? Number((breakdown.tds + breakdown.tcs).toFixed(2)) : null,
      platformFee: isAdmin ? breakdown.sellerPlatformFee : null,
      gstOnPlatformFee: isAdmin ? breakdown.sellerPlatformFeeGst : null,
      sellerPlatformTotal: isAdmin ? breakdown.sellerPlatformTotal : null,
      successFee: isAdmin ? breakdown.successFee : null,
      gstOnSuccessFee: isAdmin ? breakdown.successFeeGst : null,
      successFeeTotal: isAdmin ? breakdown.successFeeTotal : null,
      otherCharges: {
        total: isAdmin ? Number((breakdown.sellerPlatformTotal + breakdown.successFeeTotal).toFixed(2)) : null,
        platformFee: isAdmin ? breakdown.sellerPlatformFee : null,
        gstOnPlatformFee: isAdmin ? breakdown.sellerPlatformFeeGst : null,
        successFee: isAdmin ? breakdown.successFee : null,
        gstOnSuccessFee: isAdmin ? breakdown.successFeeGst : null,
        ordersCount: totalProductsSold,
        productsCount: totalProductsSold,
        platformFeePerOrder: isAdmin ? (customConfig.sellerPlatformFee ?? 15) : null,
        successFeeRate: breakdown.successFeeRate,
      },
      shippingGstAmount: isAdmin ? breakdown.shippingTotal : null,
      totalDeductions: isAdmin ? breakdown.totalSellerDeductions : null,
      netPayable: isAdmin ? breakdown.sellerNetSettlement : null,
      isMasked: !isAdmin,
    };
  }

  // Case 2: Historical/batch settlements exist with no active orders
  if (settlementGross > 0) {
    const grossSales = settlementGross;
    const basePrice = Number(latest?.basePrice || Number((grossSales / 1.18).toFixed(2)));
    const gstOnSale = Number(latest?.gstOnSale || Number((grossSales - basePrice).toFixed(2)));
    const commissionAmount = Number(sums.commissionAmount) > 0 ? Number(sums.commissionAmount) : (Number(latest?.commissionAmount) > 0 ? Number(latest?.commissionAmount) : Number((basePrice * (commissionRate / 100)).toFixed(2)));
    const gstOnCommission = Number(latest?.gstOnCommission) > 0 ? Number(latest?.gstOnCommission) : Number((commissionAmount * 0.18).toFixed(2));
    const commissionTotal = Number(latest?.commissionTotal) > 0 ? Number(latest?.commissionTotal) : Number((commissionAmount + gstOnCommission).toFixed(2));
    
    const shippingFee = Number(latest?.shippingFee) > 0 ? Number(latest?.shippingFee) : (55 * effectiveOrderCount);
    const gstOnShipping = Number(latest?.shippingGst) > 0 ? Number(latest?.shippingGst) : Number((shippingFee * 0.18).toFixed(2));
    const shippingGstAmount = Number(latest?.shippingTotal) > 0 ? Number(latest?.shippingTotal) : (Number(sums.shippingGstAmount) > 0 ? Number(sums.shippingGstAmount) : Number((shippingFee + gstOnShipping).toFixed(2)));
    
    const sellerPlatformFee = Number(latest?.sellerPlatformFee) > 0 ? Number(latest?.sellerPlatformFee) : (15 * effectiveOrderCount);
    const gstOnPlatformFee = Number(latest?.sellerPlatformFeeGst) > 0 ? Number(latest?.sellerPlatformFeeGst) : Number((sellerPlatformFee * 0.18).toFixed(2));
    const sellerPlatformTotal = Number(latest?.sellerPlatformTotal) > 0 ? Number(latest?.sellerPlatformTotal) : Number((sellerPlatformFee + gstOnPlatformFee).toFixed(2));
    
    const successFee = Number(latest?.successFeeAmount) > 0 ? Number(latest?.successFeeAmount) : Number((grossSales * 0.02).toFixed(2));
    const gstOnSuccessFee = Number(latest?.successFeeGst) > 0 ? Number(latest?.successFeeGst) : Number((successFee * 0.18).toFixed(2));
    const successFeeTotal = Number(latest?.successFeeTotal) > 0 ? Number(latest?.successFeeTotal) : Number((successFee + gstOnSuccessFee).toFixed(2));

    const tdsAmount = Number(latest?.tdsAmount) > 0 ? Number(latest?.tdsAmount) : Number((grossSales * 0.001).toFixed(2));
    const tcsAmount = Number(latest?.tcsAmount) > 0 ? Number(latest?.tcsAmount) : Number((basePrice * 0.005).toFixed(2));
    const statutoryTaxes = Number(latest?.statutoryTaxes) > 0 ? Number(latest?.statutoryTaxes) : Number((tdsAmount + tcsAmount).toFixed(2));

    const totalDeductions = Number(
      latest?.totalDeductions ||
      Number((commissionTotal + shippingGstAmount + sellerPlatformTotal + successFeeTotal + statutoryTaxes).toFixed(2))
    );
    const netPayable = Number(sums.netPayable || latest?.netPayable || Math.max(0, Number((grossSales - totalDeductions).toFixed(2))));

    return {
      period,
      grossSales,
      productsCount: totalProductsSold,
      basePrice,
      gstOnSale,
      commission: {
        category: activeCategory,
        rate: commissionRate,
        amount: isAdmin ? commissionAmount : null,
      },
      commissionAmount: isAdmin ? commissionAmount : null,
      gstOnCommission: isAdmin ? gstOnCommission : null,
      commissionTotal: isAdmin ? commissionTotal : null,
      shippingFee: isAdmin ? shippingFee : null,
      gstOnShipping: isAdmin ? gstOnShipping : null,
      shippingTotal: isAdmin ? shippingGstAmount : null,
      tdsAmount: isAdmin ? tdsAmount : null,
      tcsAmount: isAdmin ? tcsAmount : null,
      statutoryTaxes: {
        total: isAdmin ? statutoryTaxes : null,
        tds: isAdmin ? tdsAmount : null,
        tcs: isAdmin ? tcsAmount : null,
      },
      statutoryTaxAmount: isAdmin ? statutoryTaxes : null,
      platformFee: isAdmin ? sellerPlatformFee : null,
      gstOnPlatformFee: isAdmin ? gstOnPlatformFee : null,
      sellerPlatformTotal: isAdmin ? sellerPlatformTotal : null,
      successFee: isAdmin ? successFee : null,
      gstOnSuccessFee: isAdmin ? gstOnSuccessFee : null,
      successFeeTotal: isAdmin ? successFeeTotal : null,
      otherCharges: {
        total: isAdmin ? Number((sellerPlatformTotal + successFeeTotal).toFixed(2)) : null,
        platformFee: isAdmin ? sellerPlatformFee : null,
        gstOnPlatformFee: isAdmin ? gstOnPlatformFee : null,
        successFee: isAdmin ? successFee : null,
        gstOnSuccessFee: isAdmin ? gstOnSuccessFee : null,
        ordersCount: totalProductsSold,
        productsCount: totalProductsSold,
        platformFeePerOrder: isAdmin ? 15 : null,
        successFeeRate: 2,
      },
      shippingGstAmount: isAdmin ? shippingGstAmount : null,
      totalDeductions: isAdmin ? totalDeductions : null,
      netPayable: isAdmin ? netPayable : null,
      isMasked: !isAdmin,
    };
  }

  // Case 2: No settlements yet, calculate dynamically from orders or return zero
  const grossSales = ordersGross > 0 ? ordersGross : 0;
  const customConfig: Partial<SettlementFeeConfig> = {
    commissionRate,
  };
  if (commissionConfig?.flatOrderFee !== undefined) {
    customConfig.sellerPlatformFee = Number(commissionConfig.flatOrderFee);
  }

  const breakdown = calculateSettlementBreakdown(grossSales, customConfig, effectiveOrderCount);

  return {
    period,
    grossSales: breakdown.grossProductValue,
    productsCount: totalProductsSold,
    basePrice: breakdown.baseProductValue,
    gstOnSale: breakdown.productGst,
    commission: {
      category: activeCategory,
      rate: breakdown.commissionRate,
      amount: isAdmin ? breakdown.commission : null,
    },
    commissionAmount: isAdmin ? breakdown.commission : null,
    gstOnCommission: isAdmin ? breakdown.commissionGst : null,
    commissionTotal: isAdmin ? breakdown.commissionTotal : null,
    shippingFee: isAdmin ? breakdown.shipping : null,
    gstOnShipping: isAdmin ? breakdown.shippingGst : null,
    shippingTotal: isAdmin ? breakdown.shippingTotal : null,
    tdsAmount: isAdmin ? breakdown.tds : null,
    tcsAmount: isAdmin ? breakdown.tcs : null,
    statutoryTaxes: {
      total: isAdmin ? Number((breakdown.tds + breakdown.tcs).toFixed(2)) : null,
      tds: isAdmin ? breakdown.tds : null,
      tcs: isAdmin ? breakdown.tcs : null,
    },
    statutoryTaxAmount: isAdmin ? Number((breakdown.tds + breakdown.tcs).toFixed(2)) : null,
    platformFee: isAdmin ? breakdown.sellerPlatformFee : null,
    gstOnPlatformFee: isAdmin ? breakdown.sellerPlatformFeeGst : null,
    sellerPlatformTotal: isAdmin ? breakdown.sellerPlatformTotal : null,
    successFee: isAdmin ? breakdown.successFee : null,
    gstOnSuccessFee: isAdmin ? breakdown.successFeeGst : null,
    successFeeTotal: isAdmin ? breakdown.successFeeTotal : null,
    otherCharges: {
      total: isAdmin ? Number((breakdown.sellerPlatformTotal + breakdown.successFeeTotal).toFixed(2)) : null,
      platformFee: isAdmin ? breakdown.sellerPlatformFee : null,
      gstOnPlatformFee: isAdmin ? breakdown.sellerPlatformFeeGst : null,
      successFee: isAdmin ? breakdown.successFee : null,
      gstOnSuccessFee: isAdmin ? breakdown.successFeeGst : null,
      ordersCount: totalProductsSold,
      productsCount: totalProductsSold,
      platformFeePerOrder: isAdmin ? (customConfig.sellerPlatformFee ?? 15) : null,
      successFeeRate: breakdown.successFeeRate,
    },
    shippingGstAmount: isAdmin ? breakdown.shippingTotal : null,
    totalDeductions: isAdmin ? breakdown.totalSellerDeductions : null,
    netPayable: isAdmin ? breakdown.sellerNetSettlement : null,
    isMasked: !isAdmin,
  };
}
