import jwt, { JwtPayload } from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export function signToken(sellerId: string, expiresIn?: string): string {
  if (!SECRET) throw new Error("JWT_SECRET is not set — check your .env");
  return jwt.sign({ sub: sellerId }, SECRET, { expiresIn: expiresIn || EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  if (!SECRET) throw new Error("JWT_SECRET is not set — check your .env");
  return jwt.verify(token, SECRET) as JwtPayload;
}
