import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { signUserToken } from "../../utils/jwt";
import { walletService } from "../../services/wallet.service";
import { HubbleRestClient } from "../../services/hubble-rest.service";
import { razorpayService } from "../../services/razorpay.service";
import { WalletTxType } from "../../generated/prisma/client";

describe("Reward Store Security Hardening & Vulnerability Remediation", () => {
  const userToken = signUserToken("user-uuid-111");
  const poorUserToken = signUserToken("user-uuid-poor");

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default mock user
    vi.spyOn(prisma.user, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === "user-uuid-111") {
        return {
          id: "user-uuid-111",
          phone: "+919876543210",
          phoneVerified: true,
          name: "Test User",
          email: "test@cikka.app",
          ciPoints: 5000,
          cashbackBalance: 25.0,
        } as any;
      }
      if (where.id === "user-uuid-poor") {
        return {
          id: "user-uuid-poor",
          phone: "+919123456789",
          phoneVerified: true,
          name: "Poor User",
          email: "poor@cikka.app",
          ciPoints: 10,
          cashbackBalance: 0,
        } as any;
      }
      return null;
    });

    vi.spyOn(prisma.user, "findFirst").mockImplementation(async ({ where }: any) => {
      return {
        id: "user-uuid-111",
        phone: "+919876543210",
        phoneVerified: true,
        ciPoints: 5000,
        cashbackBalance: 25.0,
      } as any;
    });
  });

  describe("1. Hubble Voucher Float & Authentication Security", () => {
    it("rejects unauthenticated POST /api/hubble/orders with 401", async () => {
      const res = await request(app)
        .post("/api/hubble/orders")
        .send({
          productId: "PROD-AMAZON-100",
          denomination: 500,
          quantity: 1,
        });

      expect(res.status).toBe(401);
    });

    it("rejects POST /api/hubble/orders with 400 when user has insufficient CI Points", async () => {
      // Mock walletService to report only 10 points
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 10,
        cashPaise: 0,
        cashRupees: 0,
        lifetimeEarnedPoints: 10,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
        walletId: "w-poor",
      });

      const res = await request(app)
        .post("/api/hubble/orders")
        .set("Authorization", `Bearer ${poorUserToken}`)
        .send({
          productId: "PROD-AMAZON-100",
          denomination: 500,
          quantity: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Insufficient CI Points");
    });

    it("atomically debits CI points and rolls them back if Hubble REST API order throws", async () => {
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 5000,
        cashPaise: 0,
        cashRupees: 0,
        lifetimeEarnedPoints: 5000,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
        walletId: "w-rich",
      });

      const debitSpy = vi.spyOn(walletService, "debitPoints").mockResolvedValue({
        ledgerEntryId: "led-debit-1",
        walletId: "w-rich",
        balanceAfterPoints: 4500,
        balanceAfterPaise: 0,
      });

      const creditSpy = vi.spyOn(walletService, "creditPoints").mockResolvedValue({
        ledgerEntryId: "led-refund-1",
        walletId: "w-rich",
        balanceAfterPoints: 5000,
        balanceAfterPaise: 0,
      });

      // Simulate partner order placement failure
      vi.spyOn(HubbleRestClient, "placeOrder").mockRejectedValue(
        new Error("Hubble Partner Downstream Timeout")
      );

      const res = await request(app)
        .post("/api/hubble/orders")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          productId: "PROD-AMAZON-100",
          denomination: 500,
          quantity: 1,
        });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Hubble Partner Downstream Timeout");

      // Verify debit occurred first
      expect(debitSpy).toHaveBeenCalledWith(
        "user-uuid-111",
        500,
        WalletTxType.REDEEM_REWARD,
        expect.anything()
      );

      // Verify rollback refund was executed immediately
      expect(creditSpy).toHaveBeenCalledWith(
        "user-uuid-111",
        500,
        WalletTxType.EARN_ADMIN,
        expect.anything()
      );
    });

    it("successfully places order and burns points when balance is sufficient", async () => {
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 5000,
        cashPaise: 0,
        cashRupees: 0,
        lifetimeEarnedPoints: 5000,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
        walletId: "w-rich",
      });

      vi.spyOn(walletService, "debitPoints").mockResolvedValue({
        ledgerEntryId: "led-debit-1",
        walletId: "w-rich",
        balanceAfterPoints: 4500,
        balanceAfterPaise: 0,
      });

      vi.spyOn(HubbleRestClient, "placeOrder").mockResolvedValue({
        id: "hubble-order-123",
        referenceId: "ref-123",
        status: "SUCCESS",
        vouchers: [
          {
            id: "v-1",
            cardType: "CARD_AND_PIN_NO_SECURED",
            cardPin: "1234",
            cardNumber: "AMZ-9999",
            validTill: "2027-12-31",
            amount: 500,
          },
        ],
        failureReason: null,
      });

      const res = await request(app)
        .post("/api/hubble/orders")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          productId: "PROD-AMAZON-100",
          denomination: 500,
          quantity: 1,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.points_burned).toBe(500);
      expect(res.body.remaining_points).toBe(4500);
    });
  });

  describe("2. Hubble Partner Coins Integration (No In-Memory 100k, PostgreSQL Integration)", () => {
    it("returns 0 points (not 100,000) for an unknown user ID", async () => {
      vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.user, "findFirst").mockResolvedValue(null);

      const res = await request(app)
        .get("/api/hubble/balance?userId=unknown_hacker_user");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUCCESS");
      expect(res.body.totalCoins).toBe(0);
      expect(res.body.coins).toBe(0);
      expect(res.body.consumptionEligibility.allowed).toBe(false);
    });

    it("returns real PostgreSQL balance for resolved user", async () => {
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 3200,
        cashPaise: 0,
        cashRupees: 0,
        lifetimeEarnedPoints: 3200,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
        walletId: "w-1",
      });

      const res = await request(app)
        .get("/api/hubble/balance?userId=user-uuid-111");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUCCESS");
      expect(res.body.totalCoins).toBe(3200);
      expect(res.body.consumptionEligibility.allowed).toBe(true);
    });

    it("POST /api/hubble/debit debits real CI points with idempotency", async () => {
      const debitSpy = vi.spyOn(walletService, "debitPoints").mockResolvedValue({
        ledgerEntryId: "led-hubble-1",
        walletId: "w-1",
        balanceAfterPoints: 2200,
        balanceAfterPaise: 0,
      });

      const res = await request(app)
        .post("/api/hubble/debit")
        .send({
          userId: "user-uuid-111",
          coins: 1000,
          referenceId: "hub-ref-9876",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUCCESS");
      expect(res.body.balance).toBe(2200);
      expect(debitSpy).toHaveBeenCalledWith(
        "user-uuid-111",
        1000,
        WalletTxType.REDEEM_REWARD,
        expect.objectContaining({
          idempotencyKey: "HUBBLE_DEBIT:hub-ref-9876",
        })
      );
    });

    it("POST /api/hubble/reverse looks up original debit and refunds points", async () => {
      // 1. Mock finding original debit
      vi.spyOn(prisma.loyaltyLedger, "findUnique").mockImplementation(async ({ where }: any) => {
        if (where.idempotencyKey === "HUBBLE_DEBIT:hub-ref-9876") {
          return {
            id: "led-hubble-1",
            userId: "user-uuid-111",
            pointsDelta: -1000,
            balanceAfterPoints: 2200,
          } as any;
        }
        return null;
      });

      const creditSpy = vi.spyOn(walletService, "creditPoints").mockResolvedValue({
        ledgerEntryId: "led-rev-1",
        walletId: "w-1",
        balanceAfterPoints: 3200,
        balanceAfterPaise: 0,
      });

      const res = await request(app)
        .post("/api/hubble/reverse")
        .send({
          userId: "user-uuid-111",
          referenceId: "hub-ref-9876",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUCCESS");
      expect(res.body.balance).toBe(3200);
      expect(creditSpy).toHaveBeenCalledWith(
        "user-uuid-111",
        1000,
        WalletTxType.EARN_ADMIN,
        expect.objectContaining({
          idempotencyKey: "HUBBLE_REVERSE:hub-ref-9876",
        })
      );
    });
  });

  describe("3. Physical Rewards 3DS OTP Security", () => {
    it("rejects arbitrary 3DS OTP in development mode with 400", async () => {
      const res = await request(app)
        .post("/api/rewards/verify-card-otp")
        .send({
          order_id: "order_rw_12345",
          payment_id: "pay_rw_12345",
          otp: "999999", // Arbitrary unwhitelisted OTP
          product_name: "Sony WH-1000XM5",
          product_value: 29990,
          points_burned: 29990,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Invalid 3DS OTP code");
    });

    it("rejects arbitrary order prefix even with valid OTP", async () => {
      const res = await request(app)
        .post("/api/rewards/verify-card-otp")
        .send({
          order_id: "arbitrary_live_order",
          payment_id: "arbitrary_live_pay",
          otp: "111111",
          product_name: "Sony WH-1000XM5",
          product_value: 29990,
          points_burned: 29990,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid 3DS OTP code");
    });
  });

  describe("4. Physical Rewards Catalog Price & Points Integrity", () => {
    it("rejects point tampering when client requests fewer points than catalog price", async () => {
      // Mock catalog product priced at Rs 45,000 (45,000 CI Points)
      vi.spyOn(prisma.product, "findUnique").mockResolvedValue({
        id: "prod-apple-watch-10",
        name: "Apple Watch Series 10",
        price: 45000 as any,
        loyaltyPoints: 45000,
        stockQty: 10,
        status: "ACTIVE" as any,
        sellerId: "seller-1",
      } as any);

      // Attacker attempts to initiate redemption with 1 point for a 45,000 point item
      const res = await request(app)
        .post("/api/rewards/initiate-redemption")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          productId: "prod-apple-watch-10",
          productName: "Apple Watch Series 10",
          productValue: 45000,
          pointsRequired: 1, // Tampered!
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Points required cannot be less than catalog value");
    });

    it("rejects out-of-stock catalog items with 400", async () => {
      vi.spyOn(prisma.product, "findUnique").mockResolvedValue({
        id: "prod-sold-out",
        name: "Sold Out Headphones",
        price: 5000 as any,
        loyaltyPoints: 5000,
        stockQty: 0, // OUT OF STOCK
        status: "ACTIVE" as any,
        sellerId: "seller-1",
      } as any);

      const res = await request(app)
        .post("/api/rewards/initiate-redemption")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          productId: "prod-sold-out",
          productValue: 5000,
          pointsRequired: 5000,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("out of stock");
    });
  });

  describe("5. User Balance Endpoint Security", () => {
    it("rejects unauthenticated balance inquiry without params with 401", async () => {
      const res = await request(app).get("/api/rewards/balance");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("returns real wallet balance for authenticated user without 100k fallback", async () => {
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 750,
        cashPaise: 5000,
        cashRupees: 50.0,
        lifetimeEarnedPoints: 750,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 5000,
        lifetimeRedeemedPaise: 0,
        walletId: "w-750",
      });

      const res = await request(app)
        .get("/api/rewards/balance")
        .set("Authorization", `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.ci_points).toBe(750);
      expect(res.body.cashback_balance).toBe(50.0);
    });
  });
});

