import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";
import { razorpayRouteService } from "../../services/razorpayRoute.service";

describe("Razorpay Route Integration Tests", () => {
  let token = "";
  let sellerId = "";

  beforeEach(async () => {
    await cleanTestData(["+919999900001"]);
    const res = await createTestSeller({ phone: "+919999900001" });
    token = res.token;
    sellerId = res.seller.id;

    // Create a verified onboarding record with bank details
    await prisma.sellerOnboarding.upsert({
      where: { sellerId },
      update: {
        businessName: "Glow & Co Test Studio",
        businessType: "PRIVATE_LIMITED",
        bankAccountNumber: "9199999000011234",
        bankIfsc: "HDFC0001234",
        bankAccountHolder: "Glow & Co Test Studio",
        bankVerified: true,
      },
      create: {
        sellerId,
        businessName: "Glow & Co Test Studio",
        businessType: "PRIVATE_LIMITED",
        bankAccountNumber: "9199999000011234",
        bankIfsc: "HDFC0001234",
        bankAccountHolder: "Glow & Co Test Studio",
        bankVerified: true,
      },
    });
  });

  describe("Linked Account Provisioning", () => {
    it("should provision a linked account on Razorpay Route for seller", async () => {
      const result = await razorpayRouteService.createLinkedAccount({
        sellerId,
        businessName: "Glow & Co Test Studio",
        email: "test@glowandco.com",
        phone: "+919999900001",
        bankAccountNumber: "9199999000011234",
        bankIfsc: "HDFC0001234",
        bankAccountHolder: "Glow & Co Test Studio",
      });

      expect(result.success).toBe(true);
      expect(result.accountId).toBeDefined();
      expect(result.accountId).toMatch(/^acc_/);

      const updatedSeller = await prisma.seller.findUnique({ where: { id: sellerId } });
      expect((updatedSeller as any).razorpayAccountId).toBe(result.accountId);
    });
  });

  describe("T+7 Split Transfer & Settlement Disbursal", () => {
    it("should execute transfer with strict T+7 hold and auto-release timestamp", async () => {
      const transferRes = await razorpayRouteService.transferPaymentWithT7Hold({
        paymentId: "pay_test_payment_12345",
        sellerAccountId: "acc_test_seller_123",
        amountInPaise: 79000, // ₹790
        holdDays: 7,
      });

      expect(transferRes.success).toBe(true);
      expect(transferRes.transferId).toBeDefined();
      expect(transferRes.onHold).toBe(true);
      expect(transferRes.holdUntil).toBeDefined();

      // Ensure hold is approximately 7 days from now
      const diffDays = Math.round(
        (transferRes.holdUntil!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      expect(diffDays).toBe(7);
    });

    it("should release transfer hold on demand", async () => {
      const releaseRes = await razorpayRouteService.releaseTransferHold("trf_test_mock_123");
      expect(releaseRes.success).toBe(true);
    });

    it("should reverse transfer on order return/cancellation", async () => {
      const revRes = await razorpayRouteService.reverseTransfer("trf_test_mock_123", 79000, "Customer Return");
      expect(revRes.success).toBe(true);
      expect(revRes.reversalId).toBeDefined();
    });
  });

  describe("API Endpoints (/api/razorpay-route)", () => {
    it("should handle Route Webhook events", async () => {
      const webhookPayload = {
        event: "transfer.processed",
        payload: {
          transfer: {
            entity: {
              id: "trf_test_webhook_123",
              amount: 79000,
              on_hold: false,
              recipient_settlement_id: "setl_123456",
            },
          },
        },
      };

      const res = await request(app)
        .post("/api/razorpay-route/webhook")
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should allow settlement disburse trigger via /api/razorpay-route/disburse/:id", async () => {
      const settlement = await prisma.settlement.create({
        data: {
          sellerId,
          periodStart: new Date(),
          periodEnd: new Date(),
          category: "Cosmetics",
          grossSales: 1000,
          commissionRate: 21,
          commissionAmount: 178,
          shippingGstAmount: 182,
          netPayable: 640,
          status: "PENDING",
        } as any,
      });

      const res = await request(app)
        .post(`/api/razorpay-route/disburse/${settlement.id}`)
        .send({ forceEarlyRelease: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transferResult.onHold).toBe(true);
    });
  });
});
