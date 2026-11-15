import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSetuBillpayClient } from "../../external/setu/billpay.client";
import { setuBillpayStub } from "../../external/setu/billpay.stub";
import { SetuBillpayError } from "../../external/setu/billpay.interface";

const BASE = "https://sandbox-coudc.setu.co";
const OPTS = {
  baseUrl: BASE,
  clientId: "client-123",
  secret: "secret-xyz",
  partnerId: "partner-9",
  orgId: "org-42",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const tokenOk = (token: string, expiresIn = 300) => json({ success: true, token, expiresIn, traceId: "t-tok" });
const linkOk = (n = 1) =>
  json({ success: true, link: `https://billpay.setu.co/link-${n}`, sessionId: `sess-${n}`, traceId: `t-${n}` });

const fetchMock = vi.fn();
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));
const tokenCalls = () => calls().filter((c) => c.url.endsWith("/api/v2/auth/token"));
const linkCalls = () => calls().filter((c) => c.url.endsWith("/api/v2/ethereal/link"));

describe("Setu BillPay client (real)", () => {
  let clock = 1_000_000;
  const now = () => clock;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clock = 1_000_000;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
  });

  it("fetches a token once and reuses it for two links", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk("tok-A")).mockResolvedValueOnce(linkOk(1)).mockResolvedValueOnce(linkOk(2));
    const client = createSetuBillpayClient(() => OPTS, now);

    const a = await client.createLink({ mobileNumber: "9876543210", custID: "user-1" });
    clock += 60_000;
    const b = await client.createLink({ mobileNumber: "9876543210", custID: "user-1" });

    expect(a).toMatchObject({ link: "https://billpay.setu.co/link-1", sessionId: "sess-1", traceId: "t-1" });
    expect(b.link).toBe("https://billpay.setu.co/link-2");
    expect(tokenCalls()).toHaveLength(1);
    expect(linkCalls()).toHaveLength(2);
    expect(JSON.parse(tokenCalls()[0].init.body as string)).toEqual({ clientID: "client-123", secret: "secret-xyz" });
  });

  it("refreshes the token ~60s before it expires", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-A", 300))
      .mockResolvedValueOnce(linkOk(1))
      .mockResolvedValueOnce(tokenOk("tok-B", 300))
      .mockResolvedValueOnce(linkOk(2));
    const client = createSetuBillpayClient(() => OPTS, now);

    await client.createLink({ mobileNumber: "9876543210", custID: "user-1" });
    clock += 241_000; // 300s TTL − 60s margin has passed
    await client.createLink({ mobileNumber: "9876543210", custID: "user-1" });

    expect(tokenCalls()).toHaveLength(2);
    const auth = linkCalls().map((c) => (c.init.headers as Record<string, string>).Authorization);
    expect(auth).toEqual(["Bearer tok-A", "Bearer tok-B"]);
  });

  it("sends the documented headers and body to create link", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk("tok-A")).mockResolvedValueOnce(linkOk(1));
    const client = createSetuBillpayClient(() => OPTS, now);

    await client.createLink({
      mobileNumber: "9876543210",
      custID: "user-1",
      categoryName: "Electricity",
      billerId: "BESCOM000KAR01",
      billParams: [{ name: "Consumer Number", value: "12345" }],
      redirectTo: "transactions",
      additionalInfo: { source: "app" },
    });

    const [call] = linkCalls();
    expect(call.url).toBe(`${BASE}/api/v2/ethereal/link`);
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-PARTNER-ID": "partner-9",
      Authorization: "Bearer tok-A",
    });
    expect(JSON.parse(call.init.body as string)).toEqual({
      orgId: "org-42",
      mobileNumber: "9876543210",
      custID: "user-1",
      categoryName: "Electricity",
      billerId: "BESCOM000KAR01",
      billParams: [{ name: "Consumer Number", value: "12345" }],
      redirectTo: "transactions",
      additionalInfo: { source: "app" },
    });
  });

  it("omits optional fields that were not given", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk("tok-A")).mockResolvedValueOnce(linkOk(1));
    const client = createSetuBillpayClient(() => OPTS, now);
    await client.createLink({ mobileNumber: "9876543210", custID: "user-1" });
    expect(JSON.parse(linkCalls()[0].init.body as string)).toEqual({
      orgId: "org-42",
      mobileNumber: "9876543210",
      custID: "user-1",
    });
  });

  it("throws SetuBillpayError on a Setu 400 (no stub fallback)", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-A"))
      .mockResolvedValueOnce(
        json({ success: false, error: { code: "INVALID_MOBILE", message: "mobileNumber is invalid" }, traceId: "t-err" }, 400)
      );
    const client = createSetuBillpayClient(() => OPTS, now);

    const err = await client.createLink({ mobileNumber: "123", custID: "user-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(SetuBillpayError);
    expect(err).toMatchObject({
      status: 400,
      code: "INVALID_MOBILE",
      traceId: "t-err",
      message: "mobileNumber is invalid",
      step: "link",
    });
  });

  it("throws on a failed token request", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "bad secret" }, traceId: "t-x" }, 401)
    );
    const client = createSetuBillpayClient(() => OPTS, now);
    await expect(client.createLink({ mobileNumber: "9876543210", custID: "u" })).rejects.toMatchObject({
      name: "SetuBillpayError",
      status: 401,
      code: "INVALID_CREDENTIALS",
      step: "token",
    });
    expect(linkCalls()).toHaveLength(0);
  });

  it("throws on a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const client = createSetuBillpayClient(() => OPTS, now);
    await expect(client.createLink({ mobileNumber: "9876543210", custID: "u" })).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });

  it("refetches the token once when create link returns 401", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-A"))
      .mockResolvedValueOnce(json({ success: false, error: { code: "UNAUTHORIZED", message: "expired" } }, 401))
      .mockResolvedValueOnce(tokenOk("tok-B"))
      .mockResolvedValueOnce(linkOk(1));
    const client = createSetuBillpayClient(() => OPTS, now);

    const res = await client.createLink({ mobileNumber: "9876543210", custID: "u" });
    expect(res.sessionId).toBe("sess-1");
    expect(tokenCalls()).toHaveLength(2);
    expect((linkCalls()[1].init.headers as Record<string, string>).Authorization).toBe("Bearer tok-B");
  });

  it("gives up after a second 401", async () => {
    const unauthorized = () => json({ success: false, error: { code: "UNAUTHORIZED", message: "nope" } }, 401);
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-A"))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(tokenOk("tok-B"))
      .mockResolvedValueOnce(unauthorized());
    const client = createSetuBillpayClient(() => OPTS, now);
    await expect(client.createLink({ mobileNumber: "9876543210", custID: "u" })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws CONFIG_MISSING without calling Setu when credentials are absent", async () => {
    const client = createSetuBillpayClient(() => ({ baseUrl: BASE }), now);
    await expect(client.createLink({ mobileNumber: "9876543210", custID: "u" })).rejects.toMatchObject({
      code: "CONFIG_MISSING",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Setu BillPay client — error logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const now = () => 1_000_000;
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    errorSpy.mockRestore();
  });
  const loggedText = () => JSON.stringify(errorSpy.mock.calls);

  it("logs status, body snippet, server and x-amzn-requestid on a token 403 (no traceId)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html><body>403 Forbidden</body></html>", {
        status: 403,
        headers: { server: "awselb/2.0", "x-amzn-requestid": "amzn-req-1" },
      })
    );
    const client = createSetuBillpayClient(() => OPTS, now);

    await expect(client.createLink({ mobileNumber: "9876543210", custID: "u" })).rejects.toMatchObject({
      status: 403,
      code: "HTTP_403",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg, details] = errorSpy.mock.calls[0];
    expect(msg).toBe("[Setu BillPay] token request failed: HTTP 403");
    expect(details).toEqual({
      status: 403,
      server: "awselb/2.0",
      requestId: "amzn-req-1",
      body: "<html><body>403 Forbidden</body></html>",
    });
  });

  it("falls back to x-request-id and truncates the body to 500 chars", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-A"))
      .mockResolvedValueOnce(
        new Response("x".repeat(2000), { status: 500, headers: { "x-request-id": "req-77" } })
      );
    const client = createSetuBillpayClient(() => OPTS, now);

    await expect(client.createLink({ mobileNumber: "9876543210", custID: "u" })).rejects.toMatchObject({ status: 500 });
    const [msg, details] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe("[Setu BillPay] link request failed: HTTP 500");
    expect(details.requestId).toBe("req-77");
    expect(details.server).toBeUndefined();
    expect((details.body as string).length).toBe(500);
  });

  it("never logs the secret, the token, or the request body", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk("tok-SECRET-TOKEN"))
      .mockResolvedValueOnce(
        json({ success: false, error: { code: "INVALID_ORG", message: "orgId not found" }, token: "leaked-tok" }, 400)
      );
    const client = createSetuBillpayClient(() => OPTS, now);

    await expect(client.createLink({ mobileNumber: "9876543210", custID: "user-1" })).rejects.toMatchObject({
      code: "INVALID_ORG",
    });
    const logged = loggedText();
    expect(logged).toContain("orgId not found");
    for (const secret of ["secret-xyz", "tok-SECRET-TOKEN", "leaked-tok", "9876543210", "client-123"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("does not log on success", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk("tok-A")).mockResolvedValueOnce(linkOk(1));
    const client = createSetuBillpayClient(() => OPTS, now);
    await client.createLink({ mobileNumber: "9876543210", custID: "u" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("Setu BillPay client (stub)", () => {
  it("returns a fake Setu link and session id without network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await setuBillpayStub.createLink({ mobileNumber: "9876543210", custID: "u" });
    vi.unstubAllGlobals();
    expect(res.link).toMatch(/^https:\/\/billpay-qa\.setu\.co\/\w+$/);
    expect(res.sessionId).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
