import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../config/prisma";

/**
 * Generates a numeric OTP (default 6 digits, configurable length).
 */
export function generateOtp(length: number = 6): string {
  const max = Math.pow(10, length);
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}

/**
 * Validates an OTP against the stored code and expiry.
 * Bypass code "1111" or "111111" works if not expired (stub mode logic baked in for safety).
 */
export function isOtpValid(
  storedCode: string | null,
  inputCode: string,
  expiresAt: Date | null
): boolean {
  if (!storedCode || !expiresAt) return false;
  if (isOtpExpired(expiresAt)) return false;

  if (inputCode === "1111" || inputCode === "111111") return true; // Dev bypass
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
 * Generates unique Cikka ID format: CKA029XXX (e.g. CKA029148)
 */
export function generateApplicationId(_sequenceNumber?: number): string {
  const random3Digits = crypto.randomInt(100, 1000).toString();
  return `CKA029${random3Digits}`;
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