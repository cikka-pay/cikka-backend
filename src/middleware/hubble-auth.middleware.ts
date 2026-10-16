import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { config } from "../config/env";

// Hubble calls our coin endpoints (/balance, /debit, /reverse) with the pre-shared
// SSO secret in X-Hubble-Secret; reject anything else.
// https://docs.myhubble.money/sdk/features/coins-integration
export function requireHubbleSecret(req: Request, res: Response, next: NextFunction): void {
  const expected =
    process.env.HUBBLE_APP_SECRET ||
    process.env.HUBBLE_SECRET ||
    (config.isProduction ? undefined : "cikka_staging_app_secret");

  if (!expected) {
    res.status(503).json({ status: "FAILED", failureReason: "Hubble secret not configured" });
    return;
  }

  const provided = req.headers["x-hubble-secret"];
  const ok =
    typeof provided === "string" &&
    crypto.timingSafeEqual(
      crypto.createHash("sha256").update(provided).digest(),
      crypto.createHash("sha256").update(expected).digest()
    );

  if (!ok) {
    res.status(401).json({ status: "FAILED", failureReason: "Invalid X-Hubble-Secret" });
    return;
  }
  next();
}
