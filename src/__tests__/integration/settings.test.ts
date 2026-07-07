import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { cleanTestData, createTestSeller } from "../helpers";

describe("Settings & Profile API", () => {
  let token = "";
  let sellerId = "";

  beforeEach(async () => {
    await cleanTestData(["+919000000444"]);
    const res = await createTestSeller({ phone: "+919000000444" });
    token = res.token;
    sellerId = res.seller.id;
  });

  describe("GET /api/settings/profile", () => {
    it("Should get the seller profile", async () => {
      const res = await request(app).get("/api/settings/profile").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe("+919000000444");
    });
  });

  describe("GET /api/settings", () => {
    it("Should get settings (auto-creating them if they don't exist)", async () => {
      const res = await request(app).get("/api/settings").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.notifyNewOrder).toBe(true); // default from schema
    });
  });

  describe("PATCH /api/settings", () => {
    it("Should update settings", async () => {
      const res = await request(app)
        .patch("/api/settings")
        .set("Authorization", `Bearer ${token}`)
        .send({ notifyNewOrder: false, notifySettlement: true });

      expect(res.status).toBe(200);
      expect(res.body.notifyNewOrder).toBe(false);
      expect(res.body.notifySettlement).toBe(true);
    });
  });
});
