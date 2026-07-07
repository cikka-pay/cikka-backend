import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Orders API", () => {
  let token = "";
  let sellerId = "";
  let order1Id = "";
  let order2Id = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000345"]);
    const res = await createTestSeller({ phone: "+919000000345" });
    token = res.token;
    sellerId = res.seller.id;

    // Create some products
    const p1 = await prisma.product.create({
      data: { sellerId, name: "Product 1", sku: "P1", price: 100, status: "ACTIVE" },
    });

    // Create some orders
    const o1 = await prisma.order.create({
      data: {
        sellerId,
        orderNumber: "ORD-1",
        customerName: "Alice",
        totalAmount: 100,
        status: "PENDING",
        items: {
          create: [{ productId: p1.id, quantity: 1, unitPrice: 100 }],
        },
      },
    });
    order1Id = o1.id;

    const o2 = await prisma.order.create({
      data: {
        sellerId,
        orderNumber: "ORD-2",
        customerName: "Bob",
        totalAmount: 200,
        status: "SHIPPED",
        items: {
          create: [{ productId: p1.id, quantity: 2, unitPrice: 100 }],
        },
      },
    });
    order2Id = o2.id;
  });

  describe("GET /api/orders", () => {
    it("Should list all orders with pagination", async () => {
      const res = await request(app).get("/api/orders?page=1&limit=10").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(2);
    });

    it("Should filter orders by status", async () => {
      const res = await request(app).get("/api/orders?status=PENDING").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe("PENDING");
    });
  });

  describe("GET /api/orders/:id", () => {
    it("Should get a single order with items", async () => {
      const res = await request(app).get(`/api/orders/${order1Id}`).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.orderNumber).toBe("ORD-1");
      expect(res.body.items.length).toBe(1);
    });
  });

  describe("PATCH /api/orders/:id/status", () => {
    it("Should update order status to SHIPPED", async () => {
      const res = await request(app)
        .patch(`/api/orders/${order1Id}/status`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "SHIPPED" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SHIPPED");
    });

    it("Should update order to DELIVERED status", async () => {
      const res = await request(app)
        .patch(`/api/orders/${order1Id}/status`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "DELIVERED" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("DELIVERED");
    });

    it("Should persist trackingNumber and courier when shipping", async () => {
      const res = await request(app)
        .patch(`/api/orders/${order1Id}/status`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "SHIPPED", trackingNumber: "TRK123456", courier: "Delhivery" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SHIPPED");
      expect(res.body.trackingNumber).toBe("TRK123456");
      expect(res.body.courier).toBe("Delhivery");
    });
  });
});
