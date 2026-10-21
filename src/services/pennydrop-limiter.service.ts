import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { INSTANTPAY_ERRORS } from "../constants/errors";

export const PENNY_DROP_LIMIT = 12;
export const PENNY_DROP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
export const PENNY_DROP_EXHAUSTED_MESSAGE =
  "we have scouted limited brands for today please try again tomorrow at earliest";

// In-memory sliding window of call timestamps keyed by user identifier
const attemptHistory = new Map<string, number[]>();

export function getPennyDropKey(req: Request): { key: string; sellerId?: string; userId?: string } {
  const sellerId = req.seller?.id || (req.body as any)?.sellerId;
  const userId = (req as any).user?.id || (req.body as any)?.userId;

  if (sellerId) {
    return { key: `seller:${sellerId}`, sellerId, userId };
  }
  if (userId) {
    return { key: `user:${userId}`, sellerId, userId };
  }

  const rawIp =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    req.ip ||
    "unknown_client";
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp);
  return { key: `ip:${ip.trim()}` };
}

/**
 * Returns current count of penny drop attempts in the last 24 hours.
 */
export async function getPennyDropCountInLast24Hours(req: Request): Promise<number> {
  const { key, sellerId, userId } = getPennyDropKey(req);
  const now = Date.now();
  const cutoff = now - PENNY_DROP_WINDOW_MS;

  // Filter in-memory timestamps
  const history = attemptHistory.get(key) || [];
  const validHistory = history.filter((t) => t > cutoff);
  attemptHistory.set(key, validHistory);
  const memCount = validHistory.length;

  // Check database if available
  let dbCount = 0;
  try {
    if (prisma && prisma.bankAccountVerificationRecord && (sellerId || userId)) {
      dbCount = await prisma.bankAccountVerificationRecord.count({
        where: {
          createdAt: { gte: new Date(cutoff) },
          ...(sellerId ? { sellerId } : {}),
          ...(userId && !sellerId ? { userId } : {}),
        },
      });
    }
  } catch (err) {
    // Database access may fail in test/stub environments
  }

  return Math.max(memCount, dbCount);
}

/**
 * Record a triggered penny drop call for this user.
 */
export function recordPennyDropCall(req: Request): void {
  const { key } = getPennyDropKey(req);
  const now = Date.now();
  const cutoff = now - PENNY_DROP_WINDOW_MS;
  const history = attemptHistory.get(key) || [];
  const validHistory = history.filter((t) => t > cutoff);
  validHistory.push(now);
  attemptHistory.set(key, validHistory);
}

/**
 * Reset memory store (used by tests).
 */
export function resetPennyDropLimiter(): void {
  attemptHistory.clear();
}

/**
 * Middleware that blocks when 12 calls have been reached in 24 hours.
 */
export async function checkPennyDropRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const count = await getPennyDropCountInLast24Hours(req);

  if (count >= PENNY_DROP_LIMIT) {
    res.status(429).json({
      success: false,
      message: PENNY_DROP_EXHAUSTED_MESSAGE,
      error: PENNY_DROP_EXHAUSTED_MESSAGE,
    });
    return;
  }

  next();
}
