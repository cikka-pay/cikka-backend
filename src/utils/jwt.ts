import jwt, { JwtPayload } from "jsonwebtoken";
import { AUTH_ERRORS } from "../constants/errors";
import { config } from "../config/env";

const SELLER_SECRET = config.jwtSellerSecret;
const USER_SECRET = config.jwtUserSecret;
const EXPIRES_IN = config.jwtExpiresIn;

export interface CustomJwtPayload extends JwtPayload {
  sub: string;
  role?: "seller" | "user";
  aud?: string;
  teamMemberId?: string;
}

export function signToken(sellerId: string, expiresIn?: string, teamMemberId?: string): string {
  return signSellerToken(sellerId, expiresIn, teamMemberId);
}

export function signSellerToken(sellerId: string, expiresIn?: string, teamMemberId?: string): string {
  const secret = process.env.JWT_SELLER_SECRET || process.env.JWT_SECRET || SELLER_SECRET;
  if (!secret) throw new Error("JWT_SELLER_SECRET or JWT_SECRET is not set");
  const payload: any = { sub: sellerId, role: "seller", aud: "cikka-seller-web" };
  if (teamMemberId) {
    payload.teamMemberId = teamMemberId;
  }
  return jwt.sign(
    payload,
    secret,
    { expiresIn: expiresIn || EXPIRES_IN } as jwt.SignOptions
  );
}

export function signUserToken(userId: string, expiresIn?: string): string {
  const secret = process.env.JWT_USER_SECRET || process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET || USER_SECRET;
  if (!secret) throw new Error("JWT_USER_SECRET or JWT_SECRET is not set");
  return jwt.sign(
    { sub: userId, role: "user", aud: "cikka-mobile-app" },
    secret,
    { expiresIn: expiresIn || EXPIRES_IN } as jwt.SignOptions
  );
}

export function verifyToken(token: string): CustomJwtPayload {
  return verifySellerToken(token);
}

export function verifySellerToken(token: string): CustomJwtPayload {
  // In production only secrets we control are accepted. The hardcoded dev secrets and the
  // unsigned-token fallback below are dev conveniences — in prod they let anyone mint a token.
  const secrets = Array.from(new Set([
    process.env.JWT_SELLER_SECRET,
    process.env.JWT_SECRET,
    SELLER_SECRET,
    ...(config.isProduction ? [] : [
      "cikka-seller-dev-secret-0000000000000000",
      "cikka-dev-secret-do-not-use-in-production-0000000000000000",
    ]),
  ].filter(Boolean) as string[]));

  for (const secret of secrets) {
    try {
      const payload = jwt.verify(token, secret) as CustomJwtPayload;
      if (payload.role && payload.role !== "seller") {
        throw new Error(AUTH_ERRORS.INVALID_SELLER_TOKEN);
      }
      return payload;
    } catch (err: any) {
      if (err.message === AUTH_ERRORS.INVALID_SELLER_TOKEN) {
        throw err;
      }
      // try next secret
    }
  }

  if (!config.isProduction) {
    const decoded = jwt.decode(token) as CustomJwtPayload;
    if (decoded && decoded.sub && (!decoded.role || decoded.role === "seller")) {
      return decoded;
    }
  }

  throw new Error(AUTH_ERRORS.INVALID_SELLER_TOKEN);
}



export function verifyUserToken(token: string): CustomJwtPayload {
  const secret = process.env.JWT_USER_SECRET || process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET || USER_SECRET;
  if (!secret) throw new Error("JWT_USER_SECRET or JWT_SECRET is not set");
  try {
    const payload = jwt.verify(token, secret) as CustomJwtPayload;
    if (payload.role && payload.role !== "user") {
      throw new Error(AUTH_ERRORS.INVALID_USER_TOKEN);
    }
    return payload;
  } catch (_err) {
    throw new Error(AUTH_ERRORS.INVALID_USER_TOKEN);
  }
}


export interface AdminJwtPayload extends JwtPayload {
  id: string;
  email: string;
  role: string;
  type: "ADMIN";
}

export function getAdminSecret(): string {
  const secret = process.env.JWT_SECRET || (config.isProduction ? undefined : "cikka_super_secret_jwt_key_2026");
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

export function signAdminToken(admin: { id: string; email: string; role: string }): string {
  return jwt.sign({ ...admin, type: "ADMIN" }, getAdminSecret(), { expiresIn: "7d" });
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  const payload = jwt.verify(token, getAdminSecret()) as AdminJwtPayload;
  if (payload.type !== "ADMIN" || !payload.id) {
    throw new Error("Invalid admin token");
  }
  return payload;
}
