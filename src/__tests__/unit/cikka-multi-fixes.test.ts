import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { signUserToken } from "../../utils/jwt";
import { walletService } from "../../services/wallet.service";
import { HubbleRestClient } from "../../services/hubble-rest.service";
import { WalletTxType } from "../../generated/prisma/client";
import {
  buildNotificationMetadata,
  defaultNotificationTargetForWalletTx,
} from "../../utils/userNotifications";

describe("Backend Fixes: Rate Cikka 150 CI, Non-Expiring Coupons, Notification Metadata & Deep Links", () => {
  const userId = "user-multi-fixes-1";
  const token = signUserToken(userId);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: userId,
      phone: "+919876543210",
      phoneVerified: true,
      name: "Cikka Tester",
      email: "tester@cikka.club",
      ciPoints: 1000,
      cashbackBalance: 50,
    } as any);
  });

  describe("1. Rate Cikka +150 CI Points (/api/wallet/rate-app-reward)", () => {
    it("requires authentication", async () => {
      const res = await request(app).post("/api/wallet/rate-app-reward").send({ rating: 5 });
      expect(res.status).toBe(401);
    });

    it("credits 150 CI Points once with APP_RATING idempotency and wallet notification meta", async () => {
      const creditSpy = vi.spyOn(walletService, "creditPoints").mockResolvedValue({
        ledgerEntryId: "ledg-rate-1",
        walletId: "wal-1",
        balanceAfterPoints: 1150,
        balanceAfterPaise: 5000,
        duplicate: false,
      });

      const res = await request(app)
        .post("/api/wallet/rate-app-reward")
        .set("Authorization", `Bearer ${token}`)
        .send({ rating: 5, feedback: "Smooth experience" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.alreadyClaimed).toBe(false);
      expect(res.body.pointsAwarded).toBe(150);
      expect(res.body.balance_after_points).toBe(1150);

      expect(creditSpy).toHaveBeenCalledWith(
        userId,
        150,
        WalletTxType.EARN_ADMIN,
        expect.objectContaining({
          idempotencyKey: `APP_RATING:${userId}`,
          notificationMeta: expect.objectContaining({
            screen: "wallet",
            params: { tab: "points" },
          }),
        })
      );
    });

    it("returns alreadyClaimed=true and pointsAwarded=0 on duplicate request", async () => {
      vi.spyOn(walletService, "creditPoints").mockResolvedValue({
        ledgerEntryId: "ledg-rate-1",
        walletId: "",
        balanceAfterPoints: 1150,
        balanceAfterPaise: 5000,
        duplicate: true,
      });

      const res = await request(app)
        .post("/api/wallet/rate-app-reward")
        .set("Authorization", `Bearer ${token}`)
        .send({ rating: 5 });

      expect(res.status).toBe(200);
      expect(res.body.alreadyClaimed).toBe(true);
      expect(res.body.pointsAwarded).toBe(0);
    });

    it("reports app_rating_claimed in GET /api/wallet/balance", async () => {
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 1150,
        cashPaise: 5000,
        cashRupees: 50,
        lifetimeEarnedPoints: 1150,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 5000,
        lifetimeRedeemedPaise: 0,
        walletId: "wal-1",
      });
      vi.spyOn(prisma.loyaltyLedger, "findUnique").mockResolvedValue({ id: "ledg-rate-1" } as any);

      const res = await request(app)
        .get("/api/wallet/balance")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.app_rating_claimed).toBe(true);
      expect(res.body.balance.app_rating_claimed).toBe(true);
    });
  });

  describe("2. Coupons Never Expire Policy", () => {
    it("persists UserVoucher with validTill=null and emits my-coupons notification", async () => {
      vi.spyOn(walletService, "getBalance").mockResolvedValue({
        ciPoints: 5000,
        cashPaise: 0,
        cashRupees: 0,
        lifetimeEarnedPoints: 5000,
        lifetimeRedeemedPoints: 0,
        lifetimeEarnedPaise: 0,
        lifetimeRedeemedPaise: 0,
        walletId: "wal-1",
      });
      vi.spyOn(walletService, "debitPoints").mockResolvedValue({
        ledgerEntryId: "ledg-deb-1",
        walletId: "wal-1",
        balanceAfterPoints: 4400,
        balanceAfterPaise: 0,
      });
      vi.spyOn(HubbleRestClient, "placeOrder").mockResolvedValue({
        orderId: "HB-TEST-1",
        orderReference: "ORD-TEST-1",
        status: "SUCCESS",
        vouchers: [
          {
            id: "v-1",
            cardNumber: "AMZN-1234-5678",
            cardPin: "1122",
            amount: 100,
            validTill: "2027-01-01",
          },
        ],
        source: "HUBBLE",
        isLiveApi: true,
      } as any);
      vi.spyOn(HubbleRestClient, "getBrandById").mockResolvedValue({
        data: { id: "AMZN-1", title: "Amazon Pay", category: ["Shopping"] },
      } as any);

      const createVoucherSpy = vi
        .spyOn(prisma.userVoucher, "create")
        .mockResolvedValue({ id: "uv-1", brandTitle: "Amazon Pay" } as any);
      const createNotifSpy = vi
        .spyOn(prisma.userNotification, "create")
        .mockResolvedValue({ id: "notif-1" } as any);

      const res = await request(app)
        .post("/api/hubble/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({
          productId: "AMZN-1",
          denomination: 100,
          quantity: 1,
        });

      expect(res.status).toBe(201);
      expect(createVoucherSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            validTill: null,
            status: "ACTIVE",
          }),
        })
      );
      expect(createNotifSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            category: "rewards",
            metadata: expect.objectContaining({
              screen: "my-coupons",
              params: expect.objectContaining({
                voucherId: "uv-1",
                brandTitle: "Amazon Pay",
              }),
            }),
          }),
        })
      );
    });

    it("normalizes listed vouchers to validTill=null, neverExpires=true, and revives legacy EXPIRED rows", async () => {
      vi.spyOn(prisma.userVoucher, "findMany").mockResolvedValue([
        {
          id: "uv-legacy",
          userId,
          brandTitle: "Swiggy",
          denomination: 250,
          pointsBurned: 1500,
          validTill: new Date("2026-01-01"),
          status: "EXPIRED",
          createdAt: new Date(),
        },
      ] as any);

      const res = await request(app)
        .get("/api/user-vouchers")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.totalActiveCount).toBe(1);
      expect(res.body.vouchers[0].validTill).toBeNull();
      expect(res.body.vouchers[0].neverExpires).toBe(true);
      expect(res.body.vouchers[0].status).toBe("ACTIVE");
    });

    it("rejects EXPIRED status update on /api/user-vouchers/:id/status", async () => {
      const res = await request(app)
        .patch("/api/user-vouchers/uv-1/status")
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "EXPIRED" });

      expect(res.status).toBe(400);
    });
  });

  describe("3. Notification Metadata & Public cikka.club Deep Link Fallback Routes", () => {
    it("maps wallet transaction types to accurate navigation targets", () => {
      expect(defaultNotificationTargetForWalletTx("EARN_BBPS")).toEqual({
        screen: "payment-history",
        params: { initialFilter: "utilities" },
        actionLabel: "View Receipt",
      });
      expect(defaultNotificationTargetForWalletTx("EARN_ORDER", { orderId: "ord-9" })).toEqual({
        screen: "orders",
        params: { highlightOrderId: "ord-9" },
        actionLabel: "View Order",
      });
      const built = buildNotificationMetadata(
        { screen: "wallet", params: { tab: "points" }, actionLabel: "Open Wallet" },
        { pointsDelta: 150 }
      );
      expect(built).toEqual({
        pointsDelta: 150,
        screen: "wallet",
        params: { tab: "points" },
        actionLabel: "Open Wallet",
      });
    });

    it("serves AASA and branded fallback HTML for /invite/:code and /mall/:id", async () => {
      const aasaRes = await request(app).get("/.well-known/apple-app-site-association");
      expect(aasaRes.status).toBe(200);
      expect(aasaRes.body.applinks.details[0].paths).toContain("/invite/*");

      const inviteRes = await request(app).get("/invite/CIKKA777");
      expect(inviteRes.status).toBe(200);
      expect(inviteRes.text).toContain("cikkaapp://invite/CIKKA777");

      vi.spyOn(prisma.product, "findUnique").mockResolvedValue({
        name: "Sony WH-1000XM5",
        brand: "Sony",
        price: 29990,
        rewardPrice: null,
        imageUrl: null,
      } as any);
      const mallRes = await request(app).get("/mall/prd-sony-xm5");
      expect(mallRes.status).toBe(200);
      expect(mallRes.text).toContain("Sony WH-1000XM5");
      expect(mallRes.text).toContain("cikkaapp://mall/prd-sony-xm5");
    });
  });
});
