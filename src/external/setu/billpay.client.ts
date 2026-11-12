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
 */

export interface SetuBillpayClientOptions {
  baseUrl: string;
  clientId?: string;
  secret?: string;
  partnerId?: string;
  orgId?: string;
}

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

async function readJson(res: Response): Promise<JsonObject | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function errorFromResponse(res: Response, body: JsonObject | null, fallbackMessage: string): SetuBillpayError {
  const err = body?.error;
  return new SetuBillpayError(
    (typeof err?.message === "string" && err.message) || fallbackMessage,
    {
      status: res.status,
      code: (typeof err?.code === "string" && err.code) || `HTTP_${res.status}`,
      traceId: typeof body?.traceId === "string" ? body.traceId : undefined,
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

  function requireOptions(): Required<SetuBillpayClientOptions> {
    const opts = getOptions();
    const missing = (["clientId", "secret", "partnerId", "orgId"] as const).filter((k) => !opts[k]);
    if (missing.length > 0) {
      throw new SetuBillpayError(`Setu BillPay is not configured (missing ${missing.join(", ")})`, {
        status: 0,
        code: "CONFIG_MISSING",
      });
    }
    return { ...opts, baseUrl: opts.baseUrl.replace(/\/+$/, "") } as Required<SetuBillpayClientOptions>;
  }

  async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      throw new SetuBillpayError(`Could not reach Setu BillPay: ${e?.message || "network error"}`, {
        status: 0,
        code: "NETWORK_ERROR",
      });
    }
  }

  async function fetchToken(opts: Required<SetuBillpayClientOptions>): Promise<string> {
    const res = await post(`${opts.baseUrl}/api/v2/auth/token`, {}, { clientID: opts.clientId, secret: opts.secret });
    const body = await readJson(res);
    if (!res.ok || body?.success === false) {
      throw errorFromResponse(res, body, "Setu BillPay token request failed");
    }
    const token = body?.token;
    if (typeof token !== "string" || !token) {
      throw new SetuBillpayError("Setu BillPay token response had no token", {
        status: res.status,
        code: "INVALID_TOKEN_RESPONSE",
        traceId: body?.traceId,
      });
    }
    const expiresIn = Number(body?.expiresIn);
    const ttlMs = (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : DEFAULT_TOKEN_TTL_SECONDS) * 1000;
    // For very short TTLs, refresh at the halfway point instead of going negative.
    const margin = Math.min(TOKEN_REFRESH_MARGIN_MS, ttlMs / 2);
    cached = { token, refreshAt: now() + ttlMs - margin };
    return token;
  }

  async function getToken(opts: Required<SetuBillpayClientOptions>, forceRefresh = false): Promise<string> {
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
          `${opts.baseUrl}/api/v2/ethereal/link`,
          { "X-PARTNER-ID": opts.partnerId, Authorization: `Bearer ${token}` },
          payload
        );

      let res = await send(await getToken(opts));
      if (res.status === 401) {
        // Token revoked/expired early: drop it and retry exactly once with a fresh one.
        cached = null;
        res = await send(await getToken(opts, true));
      }

      const body = await readJson(res);
      if (!res.ok || body?.success === false) {
        throw errorFromResponse(res, body, "Setu BillPay create link failed");
      }
      if (typeof body?.link !== "string" || !body.link || body?.sessionId == null) {
        throw new SetuBillpayError("Setu BillPay create link response had no link", {
          status: res.status,
          code: "INVALID_LINK_RESPONSE",
          traceId: body?.traceId,
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
