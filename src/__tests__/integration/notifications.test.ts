import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Notifications API", () => {
  let token = "";
  let sellerId = "";
  let notifId = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000111"]);
    const res = await createTestSeller({ phone: "+919000000111" });
    token = res.token;
    sellerId = res.seller.id;

    // Create notifications
    const n = await prisma.notification.create({
      data: {
        sellerId,
        title: "New Order",
        body: "You have a new order.",
        type: "ORDER",
        read: false,
      },
    });
    notifId = n.id;

    await prisma.notification.create({
      data: {
        sellerId,
        title: "Payout Sent",
        body: "Your payout is on the way.",
        type: "SETTLEMENT",
        read: true,
      },
    });
  });

  describe("GET /api/notifications", () => {
    it("Should list notifications with unread count", async () => {
      const res = await request(app).get("/api/notifications").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.unreadCount).toBe(1);
    });
  });

  describe("PATCH /api/notifications/:id/read", () => {
    it("Should mark a single notification as read", async () => {
      const res = await request(app)
        .patch(`/api/notifications/${notifId}/read`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.read).toBe(true);
    });
  });

  describe("POST /api/notifications/mark-all-read", () => {
    it("Should mark all notifications as read", async () => {
      const res = await request(app)
        .post("/api/notifications/mark-all-read")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1); // One was unread
    });
  });
});
