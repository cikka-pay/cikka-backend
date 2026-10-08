import request from "supertest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Dashboard API", () => {
  let token = "";
  let sellerId = "";

  beforeEach(async () => {
    // Mock the date so "this week" tests are predictable
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-01-10T12:00:00Z")); // A Tuesday

    await cleanTestData(["+919000000999"]);
    const res = await createTestSeller({ phone: "+919000000999" });
    token = res.token;
    sellerId = res.seller.id;

    // Create a product with low stock
    await prisma.product.create({
      data: {
        sellerId,
        name: "Low Stock Prod",
        sku: "DASH-LOW",
        price: 100,
        stockQty: 2,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    });

    // Create orders
    await prisma.order.createMany({
      data: [
        {
          sellerId,
          orderNumber: "ORD-DASH-1",
          customerName: "Dash 1",
          totalAmount: 100,
          status: "PENDING",
          createdAt: new Date("2023-01-09T10:00:00Z"), // This week (Monday)
        },
        {
          sellerId,
          orderNumber: "ORD-DASH-2",
          customerName: "Dash 2",
          totalAmount: 200,
          status: "DELIVERED",
          createdAt: new Date("2023-01-03T10:00:00Z"), // Last week (Tuesday)
        },
      ],
    });

    // Create settlements
    await prisma.settlement.create({
      data: {
        sellerId,
        periodStart: new Date("2023-01-01T00:00:00Z"),
        periodEnd: new Date("2023-01-07T00:00:00Z"),
        category: "Cosmetics",
        grossSales: 500,
        commissionRate: 10,
        commissionAmount: 50,
        shippingFee: 55,
        shippingGst: 9.90,
        shippingTotal: 64.90,
        shippingGstAmount: 64.90,
        netPayable: 440,
        status: "PENDING",
        payoutDate: new Date("2023-01-15T00:00:00Z"),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET /api/dashboard/summary", () => {
    it("Should get dashboard summary", async () => {
      const res = await request(app).get("/api/dashboard/summary").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.netPayoutPending).toBe(440);
      expect(res.body.grossSalesThisWeek).toBe(100);
      expect(res.body.grossSalesChangePct).toBe(-50); // 100 vs 200 last week -> -50%
      expect(res.body.activeOrdersToPack).toBe(1);
      expect(res.body.lowStockCount).toBe(1);
      expect(res.body.settlementCycle.nextPayoutDate).toBeTruthy();
    });
  });

  describe("GET /api/dashboard/settlement-breakdown", () => {
    it("Should get settlement breakdown", async () => {
      const res = await request(app)
        .get("/api/dashboard/settlement-breakdown?period=month")
        .set("Authorization", `Bearer ${token}`);
        
      expect(res.status).toBe(200);
      expect(res.body.period).toBe("month");
      expect(res.body.grossSales).toBe(500);
      expect(res.body.commission.amount).toBe(50);
      expect(res.body.shippingGstAmount).toBe(64.90);
      expect(res.body.netPayable).toBe(440);
    });
  });
});
