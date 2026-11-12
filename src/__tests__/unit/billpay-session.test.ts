import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { signUserToken } from "../../utils/jwt";

// No real DB: only User.findUnique is used by the session service.
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("../../config/prisma", () => ({ prisma: { user: { findUnique } } }));

// Use the REAL Setu client (real-mode behaviour) with fixed config; fetch is stubbed per test.
vi.mock("../../external", async () => {
  const { createSetuBillpayClient } = await import("../../external/setu/billpay.client");
  return {
    setuBillpayClient: createSetuBillpayClient(() => ({
      baseUrl: "https://sandbox-coudc.setu.co",
      clientId: "client-123",
      secret: "secret-xyz",
      partnerId: "partner-9",
      orgId: "org-42",
    })),
  };
});

import billpayRoutes from "../../routes/billpay.routes";
import { errorHandler } from "../../middleware/error.middleware";
import { toTenDigitMobile } from "../../services/billpaySession.service";
import { setuBillpayClient } from "../../external";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/bbps", billpayRoutes);
  app.use(errorHandler);
  return app;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();
const USER_ID = "user-abc";
const token = () => signUserToken(USER_ID);

describe("POST /api/bbps/session", () => {
  const app = buildApp();

  beforeEach(() => {
    findUnique.mockReset();
    fetchMock.mockReset();
    (setuBillpayClient as unknown as { clearTokenCache(): void }).clearTokenCache();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 without a JWT", async () => {
    const res = await request(app).post("/api/bbps/session").send({});
    expect(res.status).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 with a seller/garbage token", async () => {
    const res = await request(app).post("/api/bbps/session").set("Authorization", "Bearer not-a-jwt").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when the user does not exist", async () => {
    findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post("/api/bbps/session").set("Authorization", `Bearer ${token()}`).send({});
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the phone is not verified", async () => {
    findUnique.mockResolvedValueOnce({ id: USER_ID, phone: "+919876543210", phoneVerified: false });
    const res = await request(app).post("/api/bbps/session").set("Authorization", `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "PHONE_NOT_VERIFIED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid redirectTo", async () => {
    const res = await request(app)
      .post("/api/bbps/session")
      .set("Authorization", `Bearer ${token()}`)
      .send({ redirectTo: "home" });
    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns 200 with the Setu link, scoped to the caller's id and 10-digit phone", async () => {
    findUnique.mockResolvedValueOnce({ id: USER_ID, phone: "+919876543210", phoneVerified: true });
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: "tok-A", expiresIn: 300, traceId: "t0" }))
      .mockResolvedValueOnce(
        json({ success: true, link: "https://billpay.setu.co/abc123", sessionId: "sess-1", traceId: "t1" })
      );

    const res = await request(app)
      .post("/api/bbps/session")
      .set("Authorization", `Bearer ${token()}`)
      .send({ categoryName: "Electricity", redirectTo: "transactions" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, link: "https://billpay.setu.co/abc123", sessionId: "sess-1" });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER_ID } }));

    const [, init] = fetchMock.mock.calls[1];
    expect(JSON.parse(init.body)).toEqual({
      orgId: "org-42",
      mobileNumber: "9876543210",
      custID: USER_ID,
      categoryName: "Electricity",
      redirectTo: "transactions",
    });
  });

  it("returns 502 with no link when Setu fails", async () => {
    findUnique.mockResolvedValueOnce({ id: USER_ID, phone: "9876543210", phoneVerified: true });
    fetchMock
      .mockResolvedValueOnce(json({ success: true, token: "tok-A", expiresIn: 300 }))
      .mockResolvedValueOnce(
        json({ success: false, error: { code: "INTERNAL", message: "boom" }, traceId: "t-err" }, 500)
      );

    const res = await request(app).post("/api/bbps/session").set("Authorization", `Bearer ${token()}`).send({});

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeTruthy();
    expect(res.body.link).toBeUndefined();
    expect(res.body.sessionId).toBeUndefined();
    expect(res.body.traceId).toBe("t-err");
  });
});

describe("toTenDigitMobile", () => {
  it.each([
    ["+919876543210", "9876543210"],
    ["919876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["+91-98765-43210", "9876543210"],
  ])("%s → %s", (input, out) => {
    expect(toTenDigitMobile(input)).toBe(out);
  });

  it("rejects numbers that are not 10 digits", () => {
    expect(toTenDigitMobile("12345")).toBeNull();
  });
});
