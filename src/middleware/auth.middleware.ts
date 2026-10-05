import { Request, Response, NextFunction } from "express";
import { verifySellerToken, verifyUserToken } from "../utils/jwt";
import { AUTH_ERRORS } from "../constants/errors";

import { prisma } from "../config/prisma";

// Verifies the seller JWT on protected seller routes and attaches `req.seller = { id, teamMemberId, role }`.
export async function requireSellerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: AUTH_ERRORS.MISSING_AUTH_HEADER });
    return;
  }

  try {
    const payload = verifySellerToken(token);
    let role = "ADMIN";

    if (payload.teamMemberId) {
      const teamMember = await prisma.teamMember.findUnique({
        where: { id: payload.teamMemberId },
      });
      if (!teamMember || teamMember.sellerId !== payload.sub || teamMember.status !== "ACTIVE") {
        res.status(403).json({ error: "Access revoked or invalid team membership" });
        return;
      }
      role = teamMember.role.toUpperCase();
    }

    req.seller = { 
      id: payload.sub as string,
      teamMemberId: payload.teamMemberId as string | undefined,
      role: role
    };
    next();
  } catch (err: any) {
    res.status(401).json({ error: err.message || AUTH_ERRORS.INVALID_SELLER_TOKEN });
  }
}

// Enforces role-based permissions on seller endpoints
export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.seller) {
      res.status(401).json({ success: false, error: AUTH_ERRORS.UNAUTHORIZED });
      return;
    }
    const userRole = (req.seller.role || "ADMIN").toUpperCase();
    const normalizedAllowed = allowedRoles.map((r) => r.toUpperCase());

    const isAllowed =
      normalizedAllowed.includes(userRole) ||
      (normalizedAllowed.includes("ADMIN") && (userRole === "OWNER" || userRole === "ADMIN"));

    if (!isAllowed) {
      res.status(403).json({
        success: false,
        error: `Access denied. Only ${allowedRoles.join(", ")} role can perform this action.`,
      });
      return;
    }
    next();
  };
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

// Verifies either seller JWT or user JWT for shared endpoints (e.g. KYC & Payment APIs).
export function requireAnyAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ success: false, error: AUTH_ERRORS.MISSING_AUTH_HEADER });
    return;
  }

  try {
    const payload = verifySellerToken(token);
    req.seller = { 
      id: payload.sub as string,
      teamMemberId: payload.teamMemberId as string | undefined
    };
    next();
    return;
  } catch (_err) {
    try {
      const payload = verifyUserToken(token);
      req.user = { id: payload.sub as string };
      next();
      return;
    } catch (_err2) {
      res.status(401).json({ success: false, error: "Invalid authentication token" });
    }
  }
}




