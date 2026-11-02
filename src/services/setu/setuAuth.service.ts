import { config } from "../../config/env";

interface CachedToken {
  token: string;
  expiresAt: number;
}

let inMemoryToken: CachedToken | null = null;

/**
 * Generates or retrieves a valid cached JWT Bearer token from Setu Auth API.
 * Uses Client ID, Client Secret, and Partner ID.
 * Refreshes 4 minutes before expiry.
 */
export async function getSetuAuthToken(): Promise<string> {
  const now = Date.now();

  // 1. Return cached token if valid (with 4-minute / 240s safety margin)
  if (inMemoryToken && inMemoryToken.expiresAt > now + 240000) {
    return inMemoryToken.token;
  }

  const isUat = config.setuEnvironment === "uat";
  const baseUrl = config.setuBaseUrl;
  const clientId = config.setuClientId;
  const secret = config.setuSecret;
  const partnerId = config.setuPartnerId;

  if (!clientId || !secret) {
    throw new Error("[SetuAuth] Client ID or Secret is not configured in environment.");
  }

  const tokenUrl = `${baseUrl.replace(/\/+$/, "")}/api/v2/auth/token`;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (partnerId) {
    requestHeaders["X-PARTNER-ID"] = partnerId;
  }

  const requestBody = JSON.stringify({
    clientID: clientId,
    secret,
  });

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: requestHeaders,
      body: requestBody,
    });

    const data: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errMsg = data.error || data.message || `HTTP ${response.status}`;
      console.error(`[SetuAuth Error] Token request failed (${response.status}):`, errMsg);
      throw new Error(`[SetuAuth] Authentication failed: ${errMsg}`);
    }

    const token = data.data?.token || data.token || data.data?.accessToken || data.accessToken;
    const expiresIn = Number(data.data?.expiresIn || data.expiresIn || 1800);

    if (!token) {
      throw new Error(`[SetuAuth] Response did not contain a valid token: ${JSON.stringify(data)}`);
    }

    inMemoryToken = {
      token,
      expiresAt: now + expiresIn * 1000,
    };

    return token;
  } catch (err: any) {
    console.error(`[SetuAuth Exception] ${err.message}`);
    throw err;
  }
}

/**
 * Returns complete HTTP headers required for Setu Payer APIs:
 * - Authorization: Bearer <token>
 * - Content-Type: application/json
 * - X-Setu-Product-Instance-Id: <productInstanceId>
 * - X-PARTNER-ID: <partnerId>
 */
export async function getSetuHeaders(): Promise<Record<string, string>> {
  const token = await getSetuAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  if (config.setuProductInstanceId) {
    headers["X-Setu-Product-Instance-Id"] = config.setuProductInstanceId;
    headers["X-Product-Instance-Id"] = config.setuProductInstanceId;
  }
  if (config.setuPartnerId) {
    headers["X-PARTNER-ID"] = config.setuPartnerId;
  }

  return headers;
}

/**
 * Clears cached token (useful for test assertions or upon 401 Unauthorized)
 */
export function clearTokenCache(): void {
  inMemoryToken = null;
}
