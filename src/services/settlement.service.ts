// Stub for the future settlement/payout job described in specs/docs/ARCHITECTURE.md.
// Not wired up to any route or scheduler yet — `prisma/seed.ts` stands in for this
// during development. Build this out (and a real scheduler) under its own spec when
// the payout cycle needs to run automatically instead of being seeded.

import { prisma } from "../config/prisma";

/**
 * Computes and writes a Settlement row for a seller for a given period, based on
 * delivered orders in that window. NOT currently called anywhere — sketch only.
 */
export async function computeSettlementForPeriod(
  sellerId: string,
  periodStart: Date,
  periodEnd: Date,
  commissionRate = 15
) {
  const orders = await prisma.order.findMany({
    where: {
      sellerId,
      status: "DELIVERED",
      createdAt: { gte: periodStart, lt: periodEnd },
    },
  });

  const grossSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  const commissionAmount = grossSales * (commissionRate / 100);
  // Placeholder shipping/GST estimate — replace with real shipping-cost + tax logic.
  const shippingGstAmount = grossSales * 0.075;
  const netPayable = grossSales - commissionAmount - shippingGstAmount;

  return prisma.settlement.create({
    data: {
      sellerId,
      periodStart,
      periodEnd,
      grossSales,
      commissionRate,
      commissionAmount,
      shippingGstAmount,
      netPayable,
      status: "PENDING",
    },
  });
}
