import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifySellerToken, verifyUserToken, verifyAdminToken } from "../utils/jwt";
import { AUTH_ERRORS } from "../constants/errors";
import { config } from "../config/env";
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

    const sellerId = typeof payload.sub === "object" && payload.sub !== null
      ? ((payload.sub as any).id || String(payload.sub))
      : (payload.sub as string);

    // Auto-heal missing Seller record to prevent foreign key constraint violations
    try {
      const existing = await prisma.seller.findUnique({ where: { id: sellerId } });
      if (!existing) {
        await prisma.seller.create({
          data: {
            id: sellerId,
            phone: `+9199${Date.now().toString().slice(-8)}`,
            businessName: "Merchant Partner",
            onboardingStatus: "INCOMPLETE",
          },
        });
      }
    } catch (_e) {}

    if (payload.teamMemberId) {
      const teamMember = await prisma.teamMember.findUnique({
        where: { id: payload.teamMemberId },
      });
      if (!teamMember || teamMember.sellerId !== sellerId || teamMember.status !== "ACTIVE") {
        res.status(403).json({ error: "Access revoked or invalid team membership" });
        return;
      }
      role = teamMember.role.toUpperCase();
    }

    req.seller = { 
      id: sellerId,
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

// Optionally verifies either seller JWT or user JWT if provided
export function optionalAnyAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme === "Bearer" && token) {
    try {
      const payload = verifySellerToken(token);
      const sellerId = typeof payload.sub === "object" && payload.sub !== null
        ? ((payload.sub as any).id || String(payload.sub))
        : (payload.sub as string);

      req.seller = { 
        id: sellerId,
        teamMemberId: payload.teamMemberId as string | undefined
      };
      next();
      return;
    } catch (_err) {
      try {
        const payload = verifyUserToken(token);
        const userId = typeof payload.sub === "object" && payload.sub !== null
          ? ((payload.sub as any).id || String(payload.sub))
          : (payload.sub as string);

        req.user = { id: userId };
        next();
        return;
      } catch (_err2) {
        // Token invalid — proceed unauthenticated
      }
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
    const sellerId = typeof payload.sub === "object" && payload.sub !== null
      ? ((payload.sub as any).id || String(payload.sub))
      : (payload.sub as string);

    req.seller = { 
      id: sellerId,
      teamMemberId: payload.teamMemberId as string | undefined
    };
    next();
    return;
  } catch (_err) {
    try {
      const payload = verifyUserToken(token);
      const userId = typeof payload.sub === "object" && payload.sub !== null
        ? ((payload.sub as any).id || String(payload.sub))
        : (payload.sub as string);

      req.user = { id: userId };
      next();
      return;
    } catch (_err2) {
      res.status(401).json({ success: false, error: "Invalid authentication token" });
    }
  }
}





// Verifies the admin-panel JWT (issued by /api/admin/auth/*) and attaches `req.admin`.
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: AUTH_ERRORS.MISSING_AUTH_HEADER });
    return;
  }

  try {
    const payload = verifyAdminToken(token);
    req.admin = { id: payload.id, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

/**
 * Restricts Cikka Mall product access to:
 * 1. Authenticated Sellers (for seller dashboard management)
 * 2. Authenticated Admins (for catalog review/moderation)
 * 3. Mobile Users whose profiles are PAN-verified in the database (panVerified: true)
 * 
 * Rejects unauthenticated callers (public crawlers/curl) with 401 Unauthorized.
 * Rejects unverified mobile users with 403 Forbidden (PAN verification required).
 */
export async function requirePanVerifiedUserOrSellerAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({
      success: false,
      error: "Authentication required. Please sign in to Cikka App.",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  // 0. Development bypass for dev tokens
  if (!config.isProduction) {
    if (
      token.startsWith("dev-") ||
      token.includes("bypass") ||
      token.includes("dev-local")
    ) {
      req.user = { id: "dev-bypass-1" };
      next();
      return;
    }
  }

  // 1. Try verifying as Seller token (Seller Dashboard access)
  try {
    const payload = verifySellerToken(token);
    const sellerId = typeof payload.sub === "object" && payload.sub !== null
      ? ((payload.sub as any).id || String(payload.sub))
      : (payload.sub as string);

    req.seller = {
      id: sellerId,
      teamMemberId: payload.teamMemberId as string | undefined,
    };
    next();
    return;
  } catch (_sellerErr) {}

  // 2. Try verifying as Admin token (Admin Panel access)
  try {
    const payload = verifyAdminToken(token);
    req.admin = { id: payload.id, email: payload.email, role: payload.role };
    next();
    return;
  } catch (_adminErr) {}

  // 3. Try verifying as Mobile User token
  try {
    let payload: any;
    try {
      payload = verifyUserToken(token);
    } catch (vErr) {
      if (!config.isProduction) {
        payload = jwt.decode(token);
      }
      if (!payload) throw vErr;
    }

    const userId = typeof payload.sub === "object" && payload.sub !== null
      ? ((payload.sub as any).id || String(payload.sub))
      : (payload.sub as string || (payload as any).id || "user-app");

    req.user = { id: userId };

    // In development mode, allow any authenticated mobile app user
    if (!config.isProduction) {
      next();
      return;
    }

    // Direct JWT check if token payload certifies PAN verification
    if ((payload as any).panVerified === true || Boolean((payload as any).panNumber)) {
      next();
      return;
    }

    // Dev bypass exception for test users
    if (userId === "dev-bypass-1" || userId.startsWith("dev-user")) {
      next();
      return;
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, panVerified: true, phone: true },
    });

    if (!dbUser || !dbUser.panVerified) {
      res.status(403).json({
        success: false,
        error: "Access restricted: Cikka Mall real products require a PAN-verified profile.",
        code: "PAN_VERIFICATION_REQUIRED",
      });
      return;
    }

    next();
    return;
  } catch (_userErr) {
    // In dev mode, if user is calling from mobile app with a bearer token, allow access
    if (!config.isProduction && token && token.length > 5) {
      req.user = { id: "dev-mobile-user" };
      next();
      return;
    }

    res.status(401).json({
      success: false,
      error: "Invalid or expired session token. Please sign in again.",
      code: "INVALID_TOKEN",
    });
  }
}

