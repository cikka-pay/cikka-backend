import { Request, Response, NextFunction } from "express";
import { AUTH_ERRORS, SETU_ERRORS } from "../constants/errors";

/**
 * Middleware for validating Setu Webhook requests.
 * Supports Basic Auth (HTTP Basic) or static Bearer token as configured in environment.
 */
export function requireSetuAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // If no auth header is provided by Setu, allow webhook unless strict auth is explicitly enabled
  if (!authHeader) {
    if (process.env.SETU_STRICT_AUTH === "true") {
      res.status(401).json({ success: false, error: AUTH_ERRORS.MISSING_AUTH_HEADER });
      return;
    }
    // Allow request to proceed for Setu webhook compatibility
    next();
    return;
  }

  const expectedUsername = process.env.SETU_BASIC_AUTH_USER || "setu_user";
  const expectedPassword = process.env.SETU_BASIC_AUTH_PASS || "setu_secret_pass";
  const expectedSecretToken = process.env.SETU_BEARER_TOKEN;

  // 1. Check HTTP Basic Auth
  if (authHeader.startsWith("Basic ")) {
    const credentials = Buffer.from(authHeader.split(" ")[1], "base64").toString("ascii");
    const [username, password] = credentials.split(":");
    if (username === expectedUsername && password === expectedPassword) {
      next();
      return;
    }
  }

  // 2. Check Bearer Auth (if token configured)
  if (authHeader.startsWith("Bearer ") && expectedSecretToken) {
    const token = authHeader.split(" ")[1];
    if (token === expectedSecretToken) {
      next();
      return;
    }
  }

  // If an Authorization header is provided but invalid, reject with 401
  res.status(401).json({ success: false, error: SETU_ERRORS.INVALID_CREDENTIALS });
}

/**
 * Production IP Whitelist middleware for Setu webhooks.
 */
export function requireSetuIpWhitelist(req: Request, res: Response, next: NextFunction): void {
  // Only enforce in production environment if SETU_ALLOWED_IPS is configured
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }

  const allowedIpsStr = process.env.SETU_ALLOWED_IPS;
  if (!allowedIpsStr) {
    next();
    return;
  }

  const allowedIps = allowedIpsStr.split(",").map((ip) => ip.trim());
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "";

  if (!allowedIps.includes(clientIp)) {
    res.status(403).json({ success: false, error: SETU_ERRORS.UNAUTHORIZED_IP(clientIp) });
    return;
  }

  next();
}

