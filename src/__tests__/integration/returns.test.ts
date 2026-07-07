import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Returns API", () => {
  let token = "";
  let sellerId = "";
  let returnId = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000888"]);
    const res = await createTestSeller({ phone: "+919000000888" });
    token = res.token;
    sellerId = res.seller.id;

    const product = await prisma.product.create({
      data: { sellerId, name: "Return Prod", sku: "RET-1", price: 500, status: "ACTIVE" },
    });

    const order = await prisma.order.create({
      data: {
        sellerId,
        orderNumber: "ORD-RET-1",
        customerName: "Charlie",
        totalAmount: 500,
        status: "DELIVERED",
      },
    });

    const ret = await prisma.return.create({
      data: {
        orderId: order.id,
        productId: product.id,
        reason: "Defective",
        status: "REQUESTED",
        refundAmount: 500,
      },
    });
    returnId = ret.id;
  });

  describe("GET /api/returns", () => {
    it("Should list all returns with pagination", async () => {
      const res = await request(app).get("/api/returns?page=1&limit=10").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].order.orderNumber).toBe("ORD-RET-1");
    });
  });

  describe("PATCH /api/returns/:id/status", () => {
    it("Should update return status", async () => {
      const res = await request(app)
        .patch(`/api/returns/${returnId}/status`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "APPROVED" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("APPROVED");
    });
  });
});
