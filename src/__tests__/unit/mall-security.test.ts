import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { signSellerToken, signUserToken } from "../../utils/jwt";
import { config } from "../../config/env";

describe("Cikka Mall Security Hardening & Vulnerability Remediation", () => {
  const sellerAToken = signSellerToken("seller-uuid-aaa");
  const sellerBToken = signSellerToken("seller-uuid-bbb");
  const userAToken = signUserToken("user-uuid-111");
  const userBToken = signUserToken("user-uuid-222");

  beforeEach(() => {
    vi.restoreAllMocks();
    // Default mock for seller auth to avoid database calls during tests
    vi.spyOn(prisma.seller, "findUnique").mockResolvedValue({
      id: "seller-uuid-aaa",
      businessName: "Aura Vogue Store",
      phone: "+919876543210",
      phoneVerified: true,
      onboardingStatus: "VERIFIED",
    } as any);
  });

  describe("1. Razorpay Route Webhook Signature Enforcement", () => {
    it("rejects webhook requests missing the x-razorpay-signature header with 401", async () => {
      const res = await request(app)
        .post("/api/razorpay-route/webhook")
        .send({ event: "transfer.processed", payload: {} });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing x-razorpay-signature header");
    });

    it("rejects webhook requests with an invalid x-razorpay-signature with 401", async () => {
      const res = await request(app)
        .post("/api/razorpay-route/webhook")
        .set("x-razorpay-signature", "invalid_forged_signature_hex")
        .send({ event: "transfer.processed", payload: {} });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid webhook signature");
    });
  });

  describe("2. Customer Delivery Address PII Protection", () => {
    it("returns empty addresses array for unauthenticated callers with no user context", async () => {
      const findManySpy = vi.spyOn(prisma.userAddress, "findMany").mockResolvedValue([]);

      const res = await request(app).get("/api/user/addresses");

      expect(res.status).toBe(200);
      expect(res.body.addresses).toEqual([]);
      if (findManySpy.mock.calls.length > 0) {
        const calledArg = findManySpy.mock.calls[0][0];
        expect(calledArg?.where).not.toEqual({});
      }
    });

    it("prevents IDOR address deletion when caller is not the owner", async () => {
      vi.spyOn(prisma.userAddress, "findUnique").mockResolvedValue({
        id: "addr-999",
        userId: "user-uuid-victim",
        phone: "+919999999999",
        fullName: "Victim User",
        addressLine1: "123 Private St",
        addressLine2: null,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // User A attempts to delete victim's address
      const res = await request(app)
        .delete("/api/user/addresses/addr-999")
        .set("Authorization", `Bearer ${userAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Unauthorized address deletion");
    });
  });

  describe("3. Unauthenticated Return & Exchange IDOR Protection", () => {
    it("rejects return creation if orderId/orderNumber is omitted (no fallback to latest order)", async () => {
      const res = await request(app)
        .post("/api/returns/request")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ reason: "Damaged" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("orderId or orderNumber is required");
    });

    it("rejects return creation on orders owned by another user", async () => {
      vi.spyOn(prisma.order, "findUnique").mockResolvedValue({
        id: "ord-victim-1",
        orderNumber: "ORD-VICTIM-1",
        userId: "user-uuid-victim",
        customerName: "Victim Customer",
        customerCity: "Bangalore",
        totalAmount: 2500 as any,
        status: "DELIVERED" as any,
        sellerId: "seller-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        seller: null as any,
        user: { id: "user-uuid-victim", phone: "+919876543210" } as any,
      } as any);

      const res = await request(app)
        .post("/api/returns/request")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ orderId: "ord-victim-1", reason: "Wrong Size" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("You can only return your own orders");
    });

    it("rejects exchange creation on orders owned by another user", async () => {
      vi.spyOn(prisma.order, "findUnique").mockResolvedValue({
        id: "ord-victim-1",
        orderNumber: "ORD-VICTIM-1",
        userId: "user-uuid-victim",
        customerName: "Victim Customer",
        customerCity: "Bangalore",
        totalAmount: 2500 as any,
        status: "DELIVERED" as any,
        sellerId: "seller-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        seller: null as any,
        user: { id: "user-uuid-victim", phone: "+919876543210" } as any,
      } as any);

      const res = await request(app)
        .post("/api/returns/exchange")
        .set("Authorization", `Bearer ${userAToken}`)
        .send({ orderId: "ord-victim-1", newProductId: "prod-new-1" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("You can only exchange your own orders");
    });
  });

  describe("4. Inventory Restock Input Validation", () => {
    it("rejects negative restock quantity with 400", async () => {
      const res = await request(app)
        .patch("/api/inventory/restock")
        .set("Authorization", `Bearer ${sellerAToken}`)
        .send({ productId: "prod-1", quantity: -50 });

      expect(res.status).toBe(400);
    });

    it("rejects zero or non-integer restock quantity with 400", async () => {
      const resZero = await request(app)
        .patch("/api/inventory/restock")
        .set("Authorization", `Bearer ${sellerAToken}`)
        .send({ productId: "prod-1", quantity: 0 });

      expect(resZero.status).toBe(400);

      const resFloat = await request(app)
        .patch("/api/inventory/restock")
        .set("Authorization", `Bearer ${sellerAToken}`)
        .send({ productId: "prod-1", quantity: 5.5 });

      expect(resFloat.status).toBe(400);
    });
  });

  describe("5. Product BOLA / Cross-Seller Isolation & Soft Deletion", () => {
    it("rejects product updates when product belongs to a different seller", async () => {
      vi.spyOn(prisma.product, "findFirst").mockResolvedValue(null);

      // Seller A tries to modify Seller B's product
      const res = await request(app)
        .patch("/api/products/prod-seller-b")
        .set("Authorization", `Bearer ${sellerAToken}`)
        .send({ price: 10 });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Product not found or not owned by seller");
    });

    it("soft-deletes product by setting status to INACTIVE instead of deleting historical order items", async () => {
      vi.spyOn(prisma.product, "findFirst").mockResolvedValue({
        id: "prod-seller-a",
        sellerId: "seller-uuid-aaa",
        name: "Test Silk Shirt",
        sku: "TEST-SKU-1",
        price: 999 as any,
        status: "ACTIVE" as any,
      } as any);

      const updateSpy = vi.spyOn(prisma.product, "update").mockResolvedValue({
        id: "prod-seller-a",
        status: "INACTIVE",
      } as any);

      const orderItemDeleteSpy = vi.spyOn(prisma.orderItem, "deleteMany");

      const res = await request(app)
        .delete("/api/products/prod-seller-a")
        .set("Authorization", `Bearer ${sellerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("archived successfully");
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "prod-seller-a" },
        data: { status: "INACTIVE" },
      });
      // Order items must NEVER be deleted
      expect(orderItemDeleteSpy).not.toHaveBeenCalled();
    });
  });

  describe("6. Shipway Logistics Multi-Tenancy & Authorization", () => {
    it("rejects unauthenticated dispatch-order requests with 401", async () => {
      const res = await request(app)
        .post("/api/shipway/dispatch-order")
        .send({ orderId: "ORD-12345" });

      expect(res.status).toBe(401);
    });

    it("prevents Seller A from dispatching Seller B's orders", async () => {
      vi.spyOn(prisma.order, "findFirst").mockResolvedValue(null);

      const res = await request(app)
        .post("/api/shipway/dispatch-order")
        .set("Authorization", `Bearer ${sellerAToken}`)
        .send({ orderId: "ORD-SELLER-B" });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Order not found or not owned by seller");
    });
  });

  describe("7. Dev-Mode 3DS Card OTP Security Guards", () => {
    it("rejects invalid 3DS OTPs that are not in the test whitelist", async () => {
      const res = await request(app)
        .post("/api/payment/verify-card-otp")
        .send({
          order_id: "order_test_123",
          payment_id: "pay_test_123",
          otp: "999999", // Invalid OTP, not 111111, 123456, or 482910
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid Bank OTP");
    });
  });
});
