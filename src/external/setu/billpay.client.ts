import { config } from "../../config/env";
import {
  SetuBillpayError,
  type BillpayLink,
  type CreateBillpayLinkInput,
  type SetuBillpayClient,
} from "./billpay.interface";

/**
 * Real Setu BillPay client (pre-built screens).
 *  - POST {base}/api/v2/auth/token    { clientID, secret } → { token, expiresIn }
 *  - POST {base}/api/v2/ethereal/link (X-PARTNER-ID + Bearer token) → { link, sessionId }
 *
 * Every failure throws SetuBillpayError. There is deliberately no stub fallback here.
 *
 * Setu only accepts requests from Indian IPs (403 with no traceId otherwise). Production
 * runs on Cloud Run in asia-south1 (Mumbai), so calls go out directly.
 *
 * Non-2xx responses are logged (status, first 500 chars of the body, `server` and request-id
 * headers). Request bodies, the secret and tokens are never logged.
 */

export interface SetuBillpayClientOptions {
  baseUrl: string;
  clientId?: string;
  secret?: string;
  partnerId?: string;
  orgId?: string;
}

type ResolvedOptions = Required<SetuBillpayClientOptions>;

type SetuStep = "token" | "link";

/** Max chars of a Setu error body we log. */
const LOG_BODY_LIMIT = 500;

/** Refresh the token this long before Setu says it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/** Used when Setu omits/garbles `expiresIn` (seconds). */
const DEFAULT_TOKEN_TTL_SECONDS = 300;

interface CachedToken {
  token: string;
  /** Epoch ms after which we fetch a new token. */
  refreshAt: number;
}

type JsonObject = Record<string, any>;

async function readBody(res: Response): Promise<{ text: string; json: JsonObject | null }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { text: "", json: null };
  }
  if (!text) return { text, json: null };
  try {
    const parsed = JSON.parse(text);
    return { text, json: parsed && typeof parsed === "object" ? parsed : null };
  } catch {
    return { text, json: null };
  }
}

function logSetuHttpError(step: SetuStep, res: Response, text: string): void {
  const snippet = text
    .slice(0, LOG_BODY_LIMIT)
    // Defensive: an error body should never carry a token, but never log one if it does.
    .replace(/("(?:token|access_token|secret)"\s*:\s*")[^"]*"/gi, '$1<redacted>"');
  console.error(`[Setu BillPay] ${step} request failed: HTTP ${res.status}`, {
    status: res.status,
    server: res.headers.get("server") ?? undefined,
    requestId: res.headers.get("x-amzn-requestid") ?? res.headers.get("x-request-id") ?? undefined,
    body: snippet,
  });
}

function describeNetworkError(e: any): string {
  // fetch wraps the useful bit (e.g. ENOTFOUND, ECONNRESET) a few causes deep.
  const parts = [e?.message || "network error"];
  let cause = e?.cause;
  for (let depth = 0; cause && depth < 4; depth++, cause = cause.cause) {
    const code = typeof cause.code === "string" ? cause.code : undefined;
    if (code || cause.message) parts.push(`(${[code, cause.message].filter(Boolean).join(": ")})`);
  }
  return parts.join(" ");
}

function errorFromResponse(
  step: SetuStep,
  res: Response,
  body: JsonObject | null,
  fallbackMessage: string
): SetuBillpayError {
  const err = body?.error;
  return new SetuBillpayError(
    (typeof err?.message === "string" && err.message) || fallbackMessage,
    {
      status: res.status,
      code: (typeof err?.code === "string" && err.code) || `HTTP_${res.status}`,
      traceId: typeof body?.traceId === "string" ? body.traceId : undefined,
      step,
    }
  );
}

export function createSetuBillpayClient(
  getOptions: () => SetuBillpayClientOptions = () => ({
    baseUrl: config.setuBillpayBaseUrl,
    clientId: config.setuBillpayClientId,
    secret: config.setuBillpaySecret,
    partnerId: config.setuBillpayPartnerId,
    orgId: config.setuBillpayOrgId,
  }),
  now: () => number = Date.now
): SetuBillpayClient & { clearTokenCache(): void } {
  let cached: CachedToken | null = null;
  let inflight: Promise<string> | null = null;

  function requireOptions(): ResolvedOptions {
    const opts = getOptions();
    const missing = (["clientId", "secret", "partnerId", "orgId"] as const).filter((k) => !opts[k]);
    if (missing.length > 0) {
      throw new SetuBillpayError(`Setu BillPay is not configured (missing ${missing.join(", ")})`, {
        status: 0,
        code: "CONFIG_MISSING",
      });
    }
    return { ...opts, baseUrl: opts.baseUrl.replace(/\/+$/, "") } as ResolvedOptions;
  }

  async function post(step: SetuStep, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      throw new SetuBillpayError(`Could not reach Setu BillPay: ${describeNetworkError(e)}`, {
        status: 0,
        code: "NETWORK_ERROR",
        step,
      });
    }
  }

  async function fetchToken(opts: ResolvedOptions): Promise<string> {
    const res = await post("token", `${opts.baseUrl}/api/v2/auth/token`, {}, {
      clientID: opts.clientId,
      secret: opts.secret,
    });
    const { text, json: body } = await readBody(res);
    if (!res.ok || body?.success === false) {
      logSetuHttpError("token", res, text);
      throw errorFromResponse("token", res, body, "Setu BillPay token request failed");
    }
    const token = body?.token;
    if (typeof token !== "string" || !token) {
      throw new SetuBillpayError("Setu BillPay token response had no token", {
        status: res.status,
        code: "INVALID_TOKEN_RESPONSE",
        traceId: body?.traceId,
        step: "token",
      });
    }
    const expiresIn = Number(body?.expiresIn);
    const ttlMs = (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_TTL_SECONDS) * 1000;
    // For very short TTLs, refresh at the halfway point instead of going negative.
    const margin = Math.min(TOKEN_REFRESH_MARGIN_MS, ttlMs / 2);
    cached = { token, refreshAt: now() + ttlMs - margin };
    return token;
  }

  async function getToken(opts: ResolvedOptions, forceRefresh = false): Promise<string> {
    if (!forceRefresh && cached && now() < cached.refreshAt) return cached.token;
    if (!inflight) {
      inflight = fetchToken(opts).finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  return {
    clearTokenCache() {
      cached = null;
    },

    async createLink(input: CreateBillpayLinkInput): Promise<BillpayLink> {
      const opts = requireOptions();

      const payload: JsonObject = {
        orgId: opts.orgId,
        mobileNumber: input.mobileNumber,
        custID: input.custID,
      };
      if (input.categoryName) payload.categoryName = input.categoryName;
      if (input.billerId) payload.billerId = input.billerId;
      if (input.billParams && input.billParams.length > 0) payload.billParams = input.billParams;
      if (input.redirectTo) payload.redirectTo = input.redirectTo;
      if (input.additionalInfo) payload.additionalInfo = input.additionalInfo;

      const send = async (token: string) =>
        post(
          "link",
          `${opts.baseUrl}/api/v2/ethereal/link`,
          { "X-PARTNER-ID": opts.partnerId, Authorization: `Bearer ${token}` },
          payload
        );

      let res = await send(await getToken(opts));
      if (res.status === 401) {
        // Token revoked/expired early: drop it and retry exactly once with a fresh one.
        logSetuHttpError("link", res, (await readBody(res)).text);
        cached = null;
        res = await send(await getToken(opts, true));
      }

      const { text, json: body } = await readBody(res);
      if (!res.ok || body?.success === false) {
        logSetuHttpError("link", res, text);
        throw errorFromResponse("link", res, body, "Setu BillPay create link failed");
      }
      if (typeof body?.link !== "string" || !body.link || body?.sessionId == null) {
        throw new SetuBillpayError("Setu BillPay create link response had no link", {
          status: res.status,
          code: "INVALID_LINK_RESPONSE",
          traceId: body?.traceId,
          step: "link",
        });
      }

      return {
        link: body.link,
        sessionId: String(body.sessionId),
        shortLink: typeof body.shortLink === "string" ? body.shortLink : undefined,
        traceId: typeof body.traceId === "string" ? body.traceId : undefined,
      };
    },
  };
}

export const setuBillpayReal = createSetuBillpayClient();
