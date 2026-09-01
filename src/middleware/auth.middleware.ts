import { Request, Response, NextFunction } from "express";
import { verifySellerToken, verifyUserToken } from "../utils/jwt";
import { AUTH_ERRORS } from "../constants/errors";

// Verifies the seller JWT on protected seller routes and attaches `req.seller = { id }`.
export function requireSellerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: AUTH_ERRORS.MISSING_AUTH_HEADER });
    return;
  }

  try {
    const payload = verifySellerToken(token);
    req.seller = { id: payload.sub as string };
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message || AUTH_ERRORS.INVALID_SELLER_TOKEN });
  }
}

// Alias for backward compatibility with existing seller routes
export const requireAuth = requireSellerAuth;

// Verifies the user JWT on protected mobile app routes and attaches `req.user = { id }`.
export function requireUserAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: AUTH_ERRORS.MISSING_AUTH_HEADER });
    return;
  }

  try {
    const payload = verifyUserToken(token);
    req.user = { id: payload.sub as string };
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message || AUTH_ERRORS.INVALID_USER_TOKEN });
  }
}

// Alias for backward compatibility
export const requireCustomerAuth = requireUserAuth;

// Optionally verifies the user JWT if provided, attaches `req.user = { id }` if valid, proceeds regardless.
export function optionalUserAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme === "Bearer" && token) {
    try {
      const payload = verifyUserToken(token);
      req.user = { id: payload.sub as string };
    } catch (_err) {
      // Token invalid or expired — proceed without req.user attached
    }
  }
  next();
}



