import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Inventory API", () => {
  let token = "";
  let sellerId = "";
  let p1Id = "";
  let p2Id = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000567"]);
    const res = await createTestSeller({ phone: "+919000000567" });
    token = res.token;
    sellerId = res.seller.id;

    const p1 = await prisma.product.create({
      data: {
        sellerId,
        name: "Low Stock Prod",
        sku: "LOW-1",
        price: 100,
        stockQty: 2,
        lowStockThreshold: 5,
        status: "ACTIVE",
      },
    });
    p1Id = p1.id;

    const p2 = await prisma.product.create({
      data: {
        sellerId,
        name: "High Stock Prod",
        sku: "HIGH-1",
        price: 100,
        stockQty: 50,
        lowStockThreshold: 10,
        status: "ACTIVE",
      },
    });
    p2Id = p2.id;
  });

  describe("GET /api/inventory/alerts", () => {
    it("Should return only products with stockQty <= lowStockThreshold", async () => {
      const res = await request(app).get("/api/inventory/alerts").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].sku).toBe("LOW-1");
    });
  });

  describe("PATCH /api/inventory/restock", () => {
    it("Should update the stock quantity of a product", async () => {
      const res = await request(app)
        .patch("/api/inventory/restock")
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: p1Id, quantity: 20 });

      expect(res.status).toBe(200);
      expect(res.body.stockQty).toBe(22); // 2 + 20
    });

    it("Should update the stock quantity of a variant if variantId is provided", async () => {
      const p3 = await prisma.product.create({
        data: {
          sellerId,
          name: "Variant Prod",
          sku: "VAR-1",
          price: 100,
          status: "ACTIVE",
          variants: {
            create: [{ typeName: "Size", value: "M", stockQty: 0, price: 100 }],
          },
        },
        include: { variants: true },
      });
      const variantId = p3.variants[0].id;

      const res = await request(app)
        .patch("/api/inventory/restock")
        .set("Authorization", `Bearer ${token}`)
        .send({ productId: p3.id, variantId, quantity: 15 });

      expect(res.status).toBe(200);
      expect(res.body.stockQty).toBe(15);
    });
  });
});
