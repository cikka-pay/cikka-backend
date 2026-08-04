import jwt, { JwtPayload } from "jsonwebtoken";

const SELLER_SECRET = process.env.JWT_SELLER_SECRET || process.env.JWT_SECRET;
const CUSTOMER_SECRET = process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export interface CustomJwtPayload extends JwtPayload {
  sub: string;
  role?: "seller" | "customer";
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

export function signCustomerToken(customerId: string, expiresIn?: string): string {
  if (!CUSTOMER_SECRET) throw new Error("JWT_CUSTOMER_SECRET or JWT_SECRET is not set");
  return jwt.sign(
    { sub: customerId, role: "customer", aud: "cikka-mobile-app" },
    CUSTOMER_SECRET,
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
    throw new Error("Invalid token role: expected seller");
  }
  return payload;
}

export function verifyCustomerToken(token: string): CustomJwtPayload {
  if (!CUSTOMER_SECRET) throw new Error("JWT_CUSTOMER_SECRET or JWT_SECRET is not set");
  const payload = jwt.verify(token, CUSTOMER_SECRET) as CustomJwtPayload;
  if (payload.role && payload.role !== "customer") {
    throw new Error("Invalid token role: expected customer");
  }
  return payload;
}

