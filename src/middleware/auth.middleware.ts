import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

// Verifies the JWT on every protected route and attaches `req.seller = { id }`.
// Every downstream query must filter by req.seller.id — see specs/AGENTS.md.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.seller = { id: payload.sub as string };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
