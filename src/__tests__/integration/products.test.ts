import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Products API", () => {
  let token = "";
  let sellerId = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000234"]);
    const res = await createTestSeller({ phone: "+919000000234" });
    token = res.token;
    sellerId = res.seller.id;
  });

  describe("POST /api/products", () => {
    it("Should create a product without variants", async () => {
      const res = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Product",
          sku: "TEST-01",
          price: 499,
          mrp: 699,
          gstSlab: 12,
          stockQty: 50,
          weightGrams: 250,
          status: "ACTIVE",
        });

      expect(res.status).toBe(201);
      expect(res.body.sku).toBe("TEST-01");
      expect(Number(res.body.price)).toBe(499);
      expect(Number(res.body.mrp)).toBe(699);
      expect(res.body.gstSlab).toBe(12);
    });

    it("Should create a product with variants", async () => {
      const res = await request(app)
        .post("/api/products")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Shirt",
          sku: "SHIRT-01",
          price: 999,
          variants: [
            { typeName: "Size", value: "M", stockQty: 10 },
            { typeName: "Size", value: "L", stockQty: 15, price: 1099 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.variants.length).toBe(2);
      expect(res.body.variants[0].value).toBe("M");
      expect(Number(res.body.variants[1].price)).toBe(1099);
    });
  });

  describe("GET /api/products", () => {
    beforeEach(async () => {
      await prisma.product.createMany({
        data: [
          { sellerId, name: "Apple", sku: "APP-01", category: "Fruit", price: 100, status: "ACTIVE" },
          { sellerId, name: "Banana", sku: "BAN-01", category: "Fruit", price: 50, status: "DRAFT" },
          { sellerId, name: "Laptop", sku: "LAP-01", category: "Electronics", price: 50000, status: "ACTIVE" },
        ],
      });
    });

    it("Should list all products with pagination", async () => {
      const res = await request(app).get("/api/products?page=1&limit=2").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(3);
    });

    it("Should filter by status", async () => {
      const res = await request(app).get("/api/products?status=DRAFT").set("Authorization", `Bearer ${token}`);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe("Banana");
    });

    it("Should search by query (q)", async () => {
      const res = await request(app).get("/api/products?q=lap").set("Authorization", `Bearer ${token}`);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe("Laptop");
    });
  });

  describe("PATCH & DELETE /api/products/:id", () => {
    let productId = "";

    beforeEach(async () => {
      const p = await prisma.product.create({
        data: { sellerId, name: "Old Name", sku: "OLD-01", price: 100, status: "ACTIVE" },
      });
      productId = p.id;
    });

    it("Should update product fields", async () => {
      const res = await request(app)
        .patch(`/api/products/${productId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "New Name", price: 200 });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
      expect(Number(res.body.price)).toBe(200);
    });

    it("Should soft delete product", async () => {
      const res = await request(app).delete(`/api/products/${productId}`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);

      const dbProd = await prisma.product.findUnique({ where: { id: productId } });
      expect(dbProd?.status).toBe("INACTIVE");
    });
  });

  describe("PATCH /api/products/:id/variants/:variantId", () => {
    it("Should update variant stock and price", async () => {
      // Create a product with a variant
      const prod = await prisma.product.create({
        data: { sellerId, name: "Variant Prod", sku: "VAR-01", price: 200, status: "ACTIVE" },
      });
      const variant = await prisma.productVariant.create({
        data: { productId: prod.id, typeName: "Size", value: "L", stockQty: 5, price: 199 },
      });

      const res = await request(app)
        .patch(`/api/products/${prod.id}/variants/${variant.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ stockQty: 25, price: 249 });

      expect(res.status).toBe(200);
      expect(res.body.stockQty).toBe(25);
      expect(Number(res.body.price)).toBe(249);
    });
  });
});
