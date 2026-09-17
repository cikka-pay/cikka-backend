/**
 * Auth Service Unit Tests (TDD)
 * Tests OTP generation, verification, expiry, and bypass logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateOtp,
  isOtpValid,
  isOtpExpired,
  hashPassword,
  checkPassword,
  generateApplicationId,
} from "../../services/auth.service";

describe("generateOtp", () => {
  it("should generate a 6-digit numeric string", () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("should generate different OTPs on successive calls", () => {
    const otps = new Set(Array.from({ length: 10 }, generateOtp));
    expect(otps.size).toBeGreaterThan(1);
  });
});

describe("isOtpValid", () => {
  it("should return true when code matches and not expired", () => {
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 min future
    expect(isOtpValid("123456", "123456", expiry)).toBe(true);
  });

  it("should return false when code is wrong", () => {
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    expect(isOtpValid("123456", "999999", expiry)).toBe(false);
  });

  it("should return false when expired", () => {
    const expiry = new Date(Date.now() - 1000); // 1s ago
    expect(isOtpValid("123456", "123456", expiry)).toBe(false);
  });

  it("should allow bypass code 111111 regardless of stored code", () => {
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    expect(isOtpValid("999999", "111111", expiry)).toBe(true);
  });

  it("bypass code 111111 still fails if expiry is past", () => {
    const expiry = new Date(Date.now() - 1000);
    expect(isOtpValid("999999", "111111", expiry)).toBe(false);
  });

  it("should return false when stored code is null", () => {
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    expect(isOtpValid(null, "123456", expiry)).toBe(false);
  });

  it("should return false when expiry is null", () => {
    expect(isOtpValid("123456", "123456", null)).toBe(false);
  });
});

describe("isOtpExpired", () => {
  it("should return true when expiry is in the past", () => {
    expect(isOtpExpired(new Date(Date.now() - 1))).toBe(true);
  });

  it("should return false when expiry is in the future", () => {
    expect(isOtpExpired(new Date(Date.now() + 10000))).toBe(false);
  });

  it("should return true when expiry is null", () => {
    expect(isOtpExpired(null)).toBe(true);
  });
});

describe("hashPassword / checkPassword", () => {
  it("should hash and verify a password correctly", async () => {
    const hash = await hashPassword("MySecret@123");
    expect(hash).not.toBe("MySecret@123");
    expect(await checkPassword("MySecret@123", hash)).toBe(true);
  });

  it("should return false for wrong password", async () => {
    const hash = await hashPassword("MySecret@123");
    expect(await checkPassword("WrongPass", hash)).toBe(false);
  });
});

describe("generateApplicationId", () => {
  it("should return format CKA029XXX", () => {
    const id = generateApplicationId();
    expect(id).toMatch(/^CKA029\d{3}$/);
  });
});
