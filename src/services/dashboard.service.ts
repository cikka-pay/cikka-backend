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

export async function getSummary(sellerId: string) {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const [netPayoutAgg, grossSalesThisWeek, grossSalesLastWeek, activeOrdersToPack, products, nextSettlement] =
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
    ]);

  const lowStockCount = products.filter((p) => p.stockQty <= p.lowStockThreshold).length;

  const grossSalesChangePct =
    grossSalesLastWeek > 0
      ? ((grossSalesThisWeek - grossSalesLastWeek) / grossSalesLastWeek) * 100
      : null;

  return {
    netPayoutPending: Number(netPayoutAgg._sum.netPayable || 0),
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

export async function getSettlementBreakdown(sellerId: string, period: "week" | "month") {
  const now = new Date();
  const from = period === "month" ? startOfMonth(now) : startOfWeek(now);

  const result = await prisma.settlement.aggregate({
    where: { sellerId, periodStart: { gte: from } },
    _sum: {
      grossSales: true,
      commissionAmount: true,
      shippingGstAmount: true,
      netPayable: true,
    },
  });

  const latest = await prisma.settlement.findFirst({
    where: { sellerId, periodStart: { gte: from } },
    orderBy: { periodStart: "desc" },
  });

  const sums = (result?._sum || {}) as any;
  const grossSales = Number(sums.grossSales || 0);
  const basePrice = Number(sums.basePrice ?? (grossSales > 0 ? grossSales / 1.18 : 0));
  const gstOnSale = Number(sums.gstOnSale ?? (grossSales - basePrice));
  const commissionRate = Number(latest?.commissionRate || 21);
  const commissionAmount = Number(sums.commissionAmount ?? (basePrice * (commissionRate / 100)));

  const gstOnCommission = Number(sums.gstOnCommission ?? (commissionAmount * 0.18));
  const shippingFee = Number(sums.shippingFee ?? (grossSales > 0 ? 150 : 0));
  const tdsAmount = Number(sums.tdsAmount ?? (grossSales * 0.001));
  const tcsAmount = Number(sums.tcsAmount ?? (basePrice * 0.005));
  const statutoryTaxes = Number(sums.statutoryTaxes ?? (tdsAmount + tcsAmount));
  const shippingGstAmount = Number(sums.shippingGstAmount ?? (shippingFee + gstOnCommission + statutoryTaxes));
  const netPayable = Number(sums.netPayable ?? Math.max(0, grossSales - commissionAmount - gstOnCommission - shippingFee - statutoryTaxes));

  return {
    period,
    grossSales,
    basePrice,
    gstOnSale,
    commission: {
      category: latest?.category ?? "Cosmetics",
      rate: commissionRate,
      amount: commissionAmount,
    },
    commissionAmount,
    gstOnCommission,
    shippingFee,
    tdsAmount,
    tcsAmount,
    statutoryTaxes: {
      total: statutoryTaxes,
      tds: tdsAmount, // 0.1% TDS on Gross
      tcs: tcsAmount, // 0.5% TCS on Net Taxable Base Price
    },
    statutoryTaxAmount: statutoryTaxes,
    shippingGstAmount,
    netPayable,
  };
}
