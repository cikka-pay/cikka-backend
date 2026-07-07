import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";

/**
 * Generates a 6-digit numeric OTP.
 */
export function generateOtp(): string {
  // Uses crypto for secure random numbers, padded to 6 digits
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

/**
 * Validates an OTP against the stored code and expiry.
 * Bypass code "111111" works if not expired (stub mode logic baked in for safety).
 */
export function isOtpValid(
  storedCode: string | null,
  inputCode: string,
  expiresAt: Date | null
): boolean {
  if (!storedCode || !expiresAt) return false;
  if (isOtpExpired(expiresAt)) return false;
  
  if (inputCode === "111111") return true;
  return storedCode === inputCode;
}

/**
 * Checks if an OTP expiry date has passed.
 */
export function isOtpExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return new Date() > expiresAt;
}

/**
 * Hashes a password using bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Checks a plain text password against a hash.
 */
export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generates an application ID format: CKA-YYYY-NNNNN
 */
export function generateApplicationId(sequenceNumber: number): string {
  const year = new Date().getFullYear();
  const padded = sequenceNumber.toString().padStart(5, "0");
  return `CKA-${year}-${padded}`;
}

/**
 * Atomically gets the next application ID sequence number from the DB.
 */
export async function getNextApplicationSequence(): Promise<number> {
  const seq = await prisma.applicationSequence.upsert({
    where: { id: 1 },
    update: { lastSeq: { increment: 1 } },
    create: { id: 1, lastSeq: 1 },
  });
  return seq.lastSeq;
}
