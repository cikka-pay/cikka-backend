import { Request, Response, NextFunction } from "express";
import { verifySellerToken, verifyCustomerToken } from "../utils/jwt";

// Verifies the seller JWT on protected seller routes and attaches `req.seller = { id }`.
export function requireSellerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  try {
    const payload = verifySellerToken(token);
    req.seller = { id: payload.sub as string };
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Invalid or expired seller token" });
  }
}

// Alias for backward compatibility with existing seller routes
export const requireAuth = requireSellerAuth;

// Verifies the customer JWT on protected mobile app routes and attaches `req.customer = { id }`.
export function requireCustomerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  try {
    const payload = verifyCustomerToken(token);
    req.customer = { id: payload.sub as string };
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Invalid or expired customer token" });
  }
}

