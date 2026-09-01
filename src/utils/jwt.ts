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
}

// Backward compatible helper for existing seller auth
export function signToken(sellerId: string, expiresIn?: string): string {
  return signSellerToken(sellerId, expiresIn);
}

export function signSellerToken(sellerId: string, expiresIn?: string): string {
  if (!SELLER_SECRET) throw new Error("JWT_SELLER_SECRET or JWT_SECRET is not set");
  return jwt.sign(
    { sub: sellerId, role: "seller", aud: "cikka-seller-web" },
    SELLER_SECRET,
    { expiresIn: expiresIn || EXPIRES_IN } as jwt.SignOptions
  );
}

export function signUserToken(userId: string, expiresIn?: string): string {
  if (!USER_SECRET) throw new Error("JWT_USER_SECRET or JWT_SECRET is not set");
  return jwt.sign(
    { sub: userId, role: "user", aud: "cikka-mobile-app" },
    USER_SECRET,
    { expiresIn: expiresIn || EXPIRES_IN } as jwt.SignOptions
  );
}

export function verifyToken(token: string): CustomJwtPayload {
  return verifySellerToken(token);
}

export function verifySellerToken(token: string): CustomJwtPayload {
  if (!SELLER_SECRET) throw new Error("JWT_SELLER_SECRET or JWT_SECRET is not set");
  const payload = jwt.verify(token, SELLER_SECRET) as CustomJwtPayload;
  if (payload.role && payload.role !== "seller") {
    throw new Error(AUTH_ERRORS.INVALID_SELLER_TOKEN);
  }
  return payload;
}

export function verifyUserToken(token: string): CustomJwtPayload {
  if (!USER_SECRET) throw new Error("JWT_USER_SECRET or JWT_SECRET is not set");
  const payload = jwt.verify(token, USER_SECRET) as CustomJwtPayload;
  if (payload.role && payload.role !== "user") {
    throw new Error(AUTH_ERRORS.INVALID_USER_TOKEN);
  }
  return payload;
}


