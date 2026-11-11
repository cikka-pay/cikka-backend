import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../../app";
import { config } from "../../config/env";
import { prisma } from "../../config/prisma";
import { clearTokenCache } from "../../services/setu/setuAuth.service";
import { signUserToken } from "../../utils/jwt";

describe("BBPS Pre-Built Screens Session & History API", () => {
  const originalRealMode = config.isRealExternalServices;

  afterEach(() => {
    config.isRealExternalServices = originalRealMode;
    clearTokenCache();
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated POST /api/bbps/session with 401", async () => {
    const res = await request(app)
      .post("/api/bbps/session")
      .send({ redirectTo: "disputes" });
    expect(res.status).toBe(401);
  });

  it("creates a Setu Dispute Center link in stub mode with transactionRef", async () => {
    config.isRealExternalServices = false;
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "user-bbps-1",
      phone: "+919876543210",
      phoneVerified: true,
    } as any);

    const token = signUserToken("user-bbps-1");
    const res = await request(app)
      .post("/api/bbps/session")
      .set("Authorization", `Bearer ${token}`)
      .send({ redirectTo: "disputes", transactionRef: "BBPS-REF-998877" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.link).toContain("https://billpay-qa.setu.co/disputes");
    expect(res.body.link).toContain("refId=BBPS-REF-998877");
    expect(res.body.link).toContain("mobileNumber=9876543210");
  });

  it("calls Setu Ethereal Link API in real mode and normalizes link without scheme", async () => {
    config.isRealExternalServices = true;
    clearTokenCache();

    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "user-bbps-2",
      phone: "+919876543210",
      phoneVerified: true,
    } as any);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init?: any) => {
      const target = String(url);
      if (target.includes("/api/v2/auth/token")) {
        return new Response(JSON.stringify({ data: { token: "setu-jwt-123", expiresIn: 1800 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (target.includes("/api/v1/ethereal/link")) {
        const sent = JSON.parse(init?.body || "{}");
        expect(sent.redirectTo).toBe("disputes");
        expect(sent.refId).toBe("TXN-DISPUTE-42");
        expect(sent.mobileNumber).toBe("9876543210");
        return new Response(
          JSON.stringify({
            success: true,
            sessionId: "12617771219030",
            link: "billpay-qa.setu.co/12617771219030",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected URL" }), { status: 404 });
    });

    const token = signUserToken("user-bbps-2");
    const res = await request(app)
      .post("/api/bbps/session")
      .set("Authorization", `Bearer ${token}`)
      .send({ redirectTo: "disputes", transactionRef: "TXN-DISPUTE-42" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionId).toBe("12617771219030");
    expect(res.body.link).toBe("https://billpay-qa.setu.co/12617771219030");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns USER_NOT_FOUND when user record is missing and INVALID_PHONE when malformed", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce(null);

    const token = signUserToken("missing-user");
    const missingRes = await request(app)
      .post("/api/bbps/session")
      .set("Authorization", `Bearer ${token}`)
      .send({ redirectTo: "disputes" });

    expect(missingRes.status).toBe(404);
    expect(missingRes.body.code).toBe("USER_NOT_FOUND");

    vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce({
      id: "bad-phone-user",
      phone: "12345",
      phoneVerified: false,
    } as any);

    const badPhoneRes = await request(app)
      .post("/api/bbps/session")
      .set("Authorization", `Bearer ${token}`)
      .send({ redirectTo: "disputes" });

    expect(badPhoneRes.status).toBe(400);
    expect(badPhoneRes.body.code).toBe("INVALID_PHONE");
  });

  it("returns structured BillpayHistoryItem list, single payment item, and 404 when absent", async () => {
    const mockTx = {
      id: "tx-1",
      internalTxnId: "CKK-BBPS-100",
      refID: "SETU-REF-100",
      billerId: "BESCOM000KAR01",
      billerName: "BESCOM Electricity",
      category: "ELECTRICITY",
      amount: "1450.00",
      status: "SUCCESS",
      setuPaymentId: "ord_setu_1",
      bbpsRefNo: "BBPS00112233",
      receiptDate: new Date("2026-11-10T10:00:00.000Z"),
      errorMessage: null,
      failureReason: null,
      customerParams: { mobileNumber: "9876543210" },
      rawPayload: {
        billAmount: "1450.00",
        disputeRefId: "DISP-01",
        disputeStatus: "OPEN",
      },
      createdAt: new Date("2026-11-10T09:59:00.000Z"),
      updatedAt: new Date("2026-11-10T10:00:00.000Z"),
    };

    vi.spyOn(prisma.bbpsTransaction, "findMany").mockResolvedValue([mockTx] as any);
    vi.spyOn(prisma.bbpsTransaction, "findFirst")
      .mockResolvedValueOnce(mockTx as any)
      .mockResolvedValueOnce(null);

    const token = signUserToken("user-bbps-1");

    const listRes = await request(app)
      .get("/api/bbps/history")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.history).toHaveLength(1);
    expect(listRes.body.history[0]).toMatchObject({
      id: "tx-1",
      bbpsTxnId: "BBPS00112233",
      refId: "SETU-REF-100",
      billAmount: "1450.00",
      amountPaid: "1450.00",
      status: "SUCCESS",
      disputeRefId: "DISP-01",
      disputeStatus: "OPEN",
    });

    const itemRes = await request(app)
      .get("/api/bbps/history/tx-1")
      .set("Authorization", `Bearer ${token}`);

    expect(itemRes.status).toBe(200);
    expect(itemRes.body.success).toBe(true);
    expect(itemRes.body.payment.id).toBe("tx-1");

    const notFoundRes = await request(app)
      .get("/api/bbps/history/does-not-exist")
      .set("Authorization", `Bearer ${token}`);

    expect(notFoundRes.status).toBe(404);
  });
});
