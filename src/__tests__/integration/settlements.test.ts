import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Settlements API", () => {
  let token = "";
  let sellerId = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000789"]);
    const res = await createTestSeller({ phone: "+919000000789" });
    token = res.token;
    sellerId = res.seller.id;

    // Create settlements
    await prisma.settlement.createMany({
      data: [
        {
          sellerId,
          periodStart: new Date("2023-01-01"),
          periodEnd: new Date("2023-01-07"),
          category: "Cosmetics",
          grossSales: 1000,
          commissionRate: 10,
          commissionAmount: 100,
          shippingGstAmount: 50,
          netPayable: 850,
          status: "PAID",
        },
        {
          sellerId,
          periodStart: new Date("2023-01-08"),
          periodEnd: new Date("2023-01-14"),
          category: "Electronics",
          grossSales: 2000,
          commissionRate: 10,
          commissionAmount: 200,
          shippingGstAmount: 100,
          netPayable: 1700,
          status: "PENDING",
        },
      ],
    });
  });

  describe("GET /api/settlements", () => {
    it("Should list all settlements with pagination", async () => {
      const res = await request(app).get("/api/settlements?page=1&limit=10").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(2);
    });

    it("Should filter by status", async () => {
      const res = await request(app).get("/api/settlements?status=PENDING").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe("PENDING");
    });
  });
});
