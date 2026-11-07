/**
 * CORS allowlist (spec 003 §11).
 * - Origins listed in CORS_ORIGIN (comma-separated, exact match, e.g.
 *   "https://seller.cikka.club,https://admin.cikka.club") are allowed.
 * - Requests without an Origin header (the mobile app, server-to-server, curl, webhooks)
 *   are not CORS requests and pass.
 * - Outside production, local development origins also pass: localhost / 127.0.0.1 / private
 *   LAN addresses on any port, Expo (exp.direct) and ngrok tunnels.
 * - "*" is not honoured in production (credentials are allowed, so a wildcard would let any
 *   site make authenticated calls).
 * Disallowed origins get no CORS headers (the browser blocks the response).
 */
import type { CorsOptions } from "cors";

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const DEV_ORIGIN = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.exp\.direct$/i,
  /^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.(app|io|dev)$/i,
];

export function isOriginAllowed(origin: string | undefined, allowlist: string[], isProduction: boolean): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (allowlist.includes(normalized)) return true;
  if (!isProduction && allowlist.includes("*")) return true;
  if (!isProduction && DEV_ORIGIN.some((re) => re.test(normalized))) return true;
  return false;
}

let warnedWildcard = false;

export function buildCorsOptions(env: { corsOrigin?: string; isProduction: boolean }): CorsOptions {
  const allowlist = parseAllowlist(env.corsOrigin);
  if (env.isProduction && allowlist.includes("*") && !warnedWildcard) {
    warnedWildcard = true;
    console.warn('[CORS] CORS_ORIGIN contains "*", which is ignored in production. List the exact origins.');
  }
  return {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowlist, env.isProduction)),
    credentials: true,
  };
}
