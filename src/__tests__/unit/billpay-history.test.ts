import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Prisma } from "../../generated/prisma/client";

vi.mock("../../config/prisma", async () => {
  const { fakePrisma } = await import("../billpayFakePrisma");
  return { prisma: fakePrisma.prisma };
});

import { fakePrisma } from "../billpayFakePrisma";
import billpayHistoryRoutes from "../../routes/billpayHistory.routes";
import { signUserToken } from "../../utils/jwt";

const app = express();
app.use(express.json());
app.use("/api/bbps", billpayHistoryRoutes);

const db = fakePrisma.db;
let aliceToken: string;
let bobToken: string;

async function seed(userId: string, orderId: string, amount: string | null) {
  return fakePrisma.prisma.bbpsTransaction.create({
    data: {
      setuOrderId: orderId,
      userId,
      billerName: "AVVNL",
      category: "Electricity",
      billAmount: amount ? new Prisma.Decimal(amount) : null,
      amountPaid: amount ? new Prisma.Decimal(amount) : null,
      status: "SUCCESS",
      paidOn: new Date("2026-11-05T08:33:27Z"),
      rawPayload: { secret: "not for clients" },
    },
  });
}

beforeAll(() => {
  process.env.JWT_USER_SECRET = process.env.JWT_USER_SECRET || "billpay-history-test-secret";
  aliceToken = signUserToken("alice");
  bobToken = signUserToken("bob");
});

beforeEach(() => {
  fakePrisma.reset();
});

describe("GET /api/bbps/history", () => {
  it("401s without a user JWT", async () => {
    const res = await request(app).get("/api/bbps/history");
    expect(res.status).toBe(401);
  });

  it("returns only the caller's payments, newest first, money as 2-decimal strings", async () => {
    await seed("alice", "ORD-A1", "601");
    await seed("bob", "ORD-B1", "99.5");
    await seed("alice", "ORD-A2", "1234.5");
    await seed("alice", "ORD-A3", null);

    const res = await request(app).get("/api/bbps/history").set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.history.map((h: any) => h.setuOrderId)).toEqual(["ORD-A3", "ORD-A2", "ORD-A1"]);
    expect(res.body.history[1].amountPaid).toBe("1234.50");
    expect(res.body.history[1].billAmount).toBe("1234.50");
    expect(res.body.history[2].amountPaid).toBe("601.00");
    expect(res.body.history[0].amountPaid).toBeNull();
    expect(res.body.history[2].paidOn).toBe("2026-11-05T08:33:27.000Z");
    expect(res.body.history[0]).not.toHaveProperty("rawPayload");
    expect(res.body.history[0]).not.toHaveProperty("userId");
  });

  it("caps the list at 50", async () => {
    for (let i = 0; i < 55; i++) await seed("alice", `ORD-${i}`, "10");
    const res = await request(app).get("/api/bbps/history").set("Authorization", `Bearer ${aliceToken}`);
    expect(res.body.history).toHaveLength(50);
  });
});

describe("GET /api/bbps/history/:id", () => {
  it("returns the caller's own payment", async () => {
    const tx = await seed("alice", "ORD-A1", "601");
    const res = await request(app).get(`/api/bbps/history/${tx.id}`).set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.payment.id).toBe(tx.id);
    expect(res.body.payment.amountPaid).toBe("601.00");
  });

  it("404s for someone else's payment", async () => {
    const tx = await seed("alice", "ORD-A1", "601");
    const res = await request(app).get(`/api/bbps/history/${tx.id}`).set("Authorization", `Bearer ${bobToken}`);
    expect(res.status).toBe(404);
    expect(db.txns).toHaveLength(1);
  });

  it("404s for an unknown id", async () => {
    const res = await request(app).get("/api/bbps/history/nope").set("Authorization", `Bearer ${aliceToken}`);
    expect(res.status).toBe(404);
  });
});
