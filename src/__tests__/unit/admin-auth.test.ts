/**
 * Admin panel auth: admin routes require an admin JWT, login checks the
 * password, access codes have no hardcoded aliases. Prisma is mocked — no DB.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { adminUser, seller } = vi.hoisted(() => ({
  adminUser: { findUnique: vi.fn() },
  seller: { findMany: vi.fn(), findUnique: vi.fn() },
}));

vi.mock("../../config/prisma", () => ({ prisma: { adminUser, seller } }));

import app from "../../app";
import { config } from "../../config/env";
import { signAdminToken, signSellerToken, verifySellerToken } from "../../utils/jwt";

describe("Admin auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seller.findMany.mockResolvedValue([]);
  });

  describe("protected admin routes", () => {
    it("rejects requests without a token", async () => {
      const res = await request(app).get("/api/admin/onboarding/applications");
      expect(res.status).toBe(401);
      expect(seller.findMany).not.toHaveBeenCalled();
    });

    it("rejects destructive routes without a token", async () => {
      const res = await request(app).delete("/api/admin/sellers/some-seller");
      expect(res.status).toBe(401);
      expect(seller.findUnique).not.toHaveBeenCalled();
    });

    it("rejects a seller token", async () => {
      const res = await request(app)
        .get("/api/admin/onboarding/applications")
        .set("Authorization", `Bearer ${signSellerToken("seller_1")}`);
      expect(res.status).toBe(401);
    });

    it("accepts an admin token", async () => {
      const token = signAdminToken({ id: "admin_1", email: "a@cikka.in", role: "SUPER_ADMIN" });
      const res = await request(app)
        .get("/api/admin/onboarding/applications")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(seller.findMany).toHaveBeenCalled();
    });

    // The seller FE's adminApi calls unimplemented /admin/* paths with a seller token;
    // a 401 there would log the seller out.
    it("still 404s unknown admin paths for a seller token", async () => {
      const res = await request(app)
        .get("/api/admin/does-not-exist")
        .set("Authorization", `Bearer ${signSellerToken("seller_1")}`);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/admin/auth/login", () => {
    it("rejects a wrong password for an existing admin", async () => {
      adminUser.findUnique.mockResolvedValue({
        id: "admin_1",
        email: "a@cikka.in",
        name: "A",
        role: "SUPER_ADMIN",
        isActive: true,
        passwordHash: await bcrypt.hash("correct-horse", 4),
      });
      const res = await request(app)
        .post("/api/admin/auth/login")
        .send({ email: "a@cikka.in", password: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();
    });

    it("does not auto-create the legacy default admin", async () => {
      adminUser.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post("/api/admin/auth/login")
        .send({ email: "admin@cikka.in", password: "admin123" });
      expect(res.status).toBe(401);
    });

    it("issues an admin token for the right password", async () => {
      adminUser.findUnique.mockResolvedValue({
        id: "admin_1",
        email: "a@cikka.in",
        name: "A",
        role: "SUPER_ADMIN",
        isActive: true,
        passwordHash: await bcrypt.hash("correct-horse", 4),
      });
      const res = await request(app)
        .post("/api/admin/auth/login")
        .send({ email: "A@cikka.in", password: "correct-horse" });
      expect(res.status).toBe(200);
      const me = await request(app).get("/api/admin/auth/me").set("Authorization", `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
    });
  });

  describe("POST /api/admin/auth/verify-access-code", () => {
    it.each(["123456", "cikka2026", "admin123"])("rejects legacy alias %s", async (code) => {
      const res = await request(app)
        .post("/api/admin/auth/verify-access-code")
        .send({ accessCode: code, panelType: "SUPER_ADMIN" });
      expect(res.status).toBe(401);
    });

    it("accepts the configured code and returns a usable token", async () => {
      const res = await request(app)
        .post("/api/admin/auth/verify-access-code")
        .send({ accessCode: config.superAdminAccessCode, panelType: "SUPER_ADMIN" });
      expect(res.status).toBe(200);
      const me = await request(app).get("/api/admin/auth/me").set("Authorization", `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
      expect(me.body.admin.role).toBe("SUPER_ADMIN");
    });
  });
});

describe("verifySellerToken", () => {
  it("rejects an unsigned (forged) token", () => {
    const forged = jwt.sign({ sub: "victim_seller", role: "seller" }, "attacker-secret");
    expect(() => verifySellerToken(forged)).toThrow();
  });

  it("rejects an admin token", () => {
    const token = signAdminToken({ id: "admin_1", email: "a@cikka.in", role: "SUPER_ADMIN" });
    expect(() => verifySellerToken(token)).toThrow();
  });

  it("accepts a real seller token", () => {
    expect(verifySellerToken(signSellerToken("seller_1")).sub).toBe("seller_1");
  });
});
