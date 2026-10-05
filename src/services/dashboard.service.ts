import { prisma } from "../config/prisma";

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

  const [netPayoutAgg, grossSalesThisWeek, grossSalesLastWeek, activeOrdersToPack, products, nextSettlement, commissionConfig, onboarding] =
    await Promise.all([
      prisma.settlement.aggregate({
        where: { sellerId, status: "PENDING" },
        _sum: { netPayable: true },
      }),
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

  // Calculate Net Payout using exact formula:
  // Gross sales - Cikka commission on net base - 18% GST on commission - Shipping cost - 18% GST on shipping - 2% success charge on GSV - 18% GST on success charge - Platform fee (15 rupee) - 18% GST on platform fee - TAX (TDS: 0.1% on gross + 0.5% on net base)
  let netPayout = Number(netPayoutAgg._sum.netPayable || 0);

  if (netPayout === 0 && grossSalesThisWeek > 0) {
    const commRate = 12.5;
    const netBase = Number((grossSalesThisWeek / 1.18).toFixed(2));
    const comm = Number((netBase * (commRate / 100)).toFixed(2));
    const gstComm = Number((comm * 0.18).toFixed(2));
    const ship = 55;
    const gstShip = Number((ship * 0.18).toFixed(2));
    const succ = Number((grossSalesThisWeek * 0.02).toFixed(2));
    const gstSucc = Number((succ * 0.18).toFixed(2));
    const plat = 15;
    const gstPlat = Number((plat * 0.18).toFixed(2));
    const tds = Number((grossSalesThisWeek * 0.001).toFixed(2));
    const tcs = Number((netBase * 0.005).toFixed(2));
    const tax = Number((tds + tcs).toFixed(2));
    const totalDeductions = comm + gstComm + ship + gstShip + succ + gstSucc + plat + gstPlat + tax;
    netPayout = Math.max(0, Number((grossSalesThisWeek - totalDeductions).toFixed(2)));
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
      nextPayoutDate: nextSettlement?.payoutDate ?? null,
    },
  };
}

export async function getSettlementBreakdown(sellerId: string, period: "week" | "month", role: string = "ADMIN") {
  const now = new Date();
  const from = period === "month" ? startOfMonth(now) : startOfWeek(now);

  const [settlementResult, ordersGrossResult, ordersCount, latest, commissionConfig, onboarding] = await Promise.all([
    prisma.settlement.aggregate({
      where: { sellerId, periodStart: { gte: from } },
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
    prisma.settlement.findFirst({
      where: { sellerId, periodStart: { gte: from } },
      orderBy: { periodStart: "desc" },
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
  let defaultRate = 12.5;
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
  const grossSales = settlementGross > 0 ? settlementGross : (ordersGross > 0 ? ordersGross : 4999);

  // Net Base is exclusive of 18% GST: GSV / 1.18 (e.g. 1000 => 847.46)
  const basePrice = grossSales > 0 ? Number((grossSales / 1.18).toFixed(2)) : 0;
  const gstOnSale = Number((grossSales - basePrice).toFixed(2));
  const commissionRate = Number(latest?.commissionRate ?? defaultRate);

  // Cikka Commission on Net Base
  const commissionAmount = Number((basePrice * (commissionRate / 100)).toFixed(2));
  // 18% GST on Commission
  const gstOnCommission = Number((commissionAmount * 0.18).toFixed(2));

  // Order count for fee multiplier
  const effectiveOrderCount = Math.max(ordersCount, grossSales > 0 ? 1 : 0);

  // Shipping costs & 18% GST on shipping
  const shippingFee = grossSales > 0 ? Number((55 * effectiveOrderCount).toFixed(2)) : 0;
  const gstOnShipping = Number((shippingFee * 0.18).toFixed(2));

  // 2% Success charge on GSV & 18% GST on success charge
  const successFee = grossSales > 0 ? Number((grossSales * 0.02).toFixed(2)) : 0;
  const gstOnSuccessFee = Number((successFee * 0.18).toFixed(2));

  // Platform fee (15 rupee per order) & 18% GST on platform fee
  const flatFeePerOrder = commissionConfig?.flatOrderFee !== undefined ? Number(commissionConfig.flatOrderFee) : 15;
  const platformFee = grossSales > 0 ? Number((effectiveOrderCount * flatFeePerOrder).toFixed(2)) : 0;
  const gstOnPlatformFee = Number((platformFee * 0.18).toFixed(2));

  // TAX (TDS: 0.1% on gross and TCS: 0.5% on net base)
  const tdsAmount = Number((grossSales * 0.001).toFixed(2));
  const tcsAmount = Number((basePrice * 0.005).toFixed(2));
  const statutoryTaxes = Number((tdsAmount + tcsAmount).toFixed(2));

  // Total deductions
  const totalDeductions = Number(
    (
      commissionAmount +
      gstOnCommission +
      shippingFee +
      gstOnShipping +
      successFee +
      gstOnSuccessFee +
      platformFee +
      gstOnPlatformFee +
      statutoryTaxes
    ).toFixed(2)
  );

  // Net Payout = Gross sales - all itemized deductions
  const netPayable = Math.max(0, Number((grossSales - totalDeductions).toFixed(2)));

  const isAdmin = role.toUpperCase() === "ADMIN" || role.toUpperCase() === "OWNER";

  return {
    period,
    grossSales,
    basePrice,
    gstOnSale,
    commission: {
      category: activeCategory,
      rate: commissionRate,
      amount: isAdmin ? commissionAmount : null,
    },
    commissionAmount: isAdmin ? commissionAmount : null,
    gstOnCommission: isAdmin ? gstOnCommission : null,
    shippingFee: isAdmin ? shippingFee : null,
    gstOnShipping: isAdmin ? gstOnShipping : null,
    tdsAmount: isAdmin ? tdsAmount : null,
    tcsAmount: isAdmin ? tcsAmount : null,
    statutoryTaxes: {
      total: isAdmin ? statutoryTaxes : null,
      tds: isAdmin ? tdsAmount : null,
      tcs: isAdmin ? tcsAmount : null,
    },
    statutoryTaxAmount: isAdmin ? statutoryTaxes : null,
    platformFee: isAdmin ? platformFee : null,
    gstOnPlatformFee: isAdmin ? gstOnPlatformFee : null,
    successFee: isAdmin ? successFee : null,
    gstOnSuccessFee: isAdmin ? gstOnSuccessFee : null,
    otherCharges: {
      total: isAdmin ? Number((platformFee + gstOnPlatformFee + successFee + gstOnSuccessFee).toFixed(2)) : null,
      platformFee: isAdmin ? platformFee : null,
      gstOnPlatformFee: isAdmin ? gstOnPlatformFee : null,
      successFee: isAdmin ? successFee : null,
      gstOnSuccessFee: isAdmin ? gstOnSuccessFee : null,
      ordersCount: effectiveOrderCount,
      platformFeePerOrder: isAdmin ? flatFeePerOrder : null,
      successFeeRate: 2,
    },
    shippingGstAmount: isAdmin ? Number((shippingFee + gstOnShipping).toFixed(2)) : null,
    totalDeductions: isAdmin ? totalDeductions : null,
    netPayable: isAdmin ? netPayable : null,
    isMasked: !isAdmin,
  };
}
