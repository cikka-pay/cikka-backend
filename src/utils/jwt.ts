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
  // Tokens are signed with JWT_SELLER_SECRET, or JWT_SECRET when that is unset.
  const secrets = [...new Set([process.env.JWT_SELLER_SECRET, process.env.JWT_SECRET, SELLER_SECRET])].filter(
    Boolean
  ) as string[];

  for (const secret of secrets) {
    let payload: CustomJwtPayload;
    try {
      payload = jwt.verify(token, secret) as CustomJwtPayload;
    } catch (_err) {
      continue; // try next secret
    }
    if ((payload.role && payload.role !== "seller") || !payload.sub) {
      throw new Error(AUTH_ERRORS.INVALID_SELLER_TOKEN);
    }
    return payload;
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

export function signAdminToken(admin: { id: string; email: string; role: string }): string {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, type: "ADMIN" },
    config.jwtAdminSecret,
    { expiresIn: config.jwtAdminExpiresIn } as jwt.SignOptions
  );
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  let payload: AdminJwtPayload;
  try {
    payload = jwt.verify(token, config.jwtAdminSecret) as AdminJwtPayload;
  } catch (_err) {
    throw new Error(AUTH_ERRORS.INVALID_ADMIN_TOKEN);
  }
  if (payload.type !== "ADMIN" || !payload.id) {
    throw new Error(AUTH_ERRORS.INVALID_ADMIN_TOKEN);
  }
  return payload;
}
