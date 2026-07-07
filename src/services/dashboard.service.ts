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

  // Use the most recent settlement's rate/category as the display label —
  // good enough while commission rate is uniform per seller; revisit if it
  // ever varies within a single period (see PRD open questions).
  const latest = await prisma.settlement.findFirst({
    where: { sellerId, periodStart: { gte: from } },
    orderBy: { periodStart: "desc" },
  });

  return {
    period,
    grossSales: Number(result._sum.grossSales || 0),
    commission: {
      category: latest?.category ?? "Cosmetics",
      rate: Number(latest?.commissionRate || 0),
      amount: Number(result._sum.commissionAmount || 0),
    },
    shippingGstAmount: Number(result._sum.shippingGstAmount || 0),
    netPayable: Number(result._sum.netPayable || 0),
  };
}
