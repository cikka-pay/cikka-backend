import { walletService } from "./wallet.service";
import { WalletTxType } from "../generated/prisma/client";
import { config } from "../config/env";
import { prisma } from "../config/prisma";
import { AUTH_ERRORS } from "../constants/errors";
import { otpService } from "../external";
import { signUserToken } from "../utils/jwt";
import { normalizePhone } from "../utils/phone";
import { generateOtp, isOtpValid } from "./auth.service";

// In-memory OTP store for transient verification (production uses Redis/Cache)
const pendingOtps = new Map<string, { code: string; expiresAt: Date }>();

export function isDevBypassPhone(raw: string): boolean {
  if (!raw) return false;
  const digits = raw.replace(/\D/g, "");
  const without91 = digits.startsWith("91") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;
  return (
    without91 === "1111111111" ||
    without91 === "11111111111" ||
    digits === "1111111111" ||
    digits === "11111111111" ||
    digits.endsWith("1111111111")
  );
}

export async function sendUserOtpService(phoneRaw: string) {
  const { phone } = normalizePhone(phoneRaw);
  const isBypassUser = isDevBypassPhone(phoneRaw) || isDevBypassPhone(phone);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Dev Bypass User: 1111111111 / 11111111111 (No SMS sent, MSG91 NEVER called, OTP: 111111, PAN: AAAAA1111A)
  if (isBypassUser) {
    const bypassOtp = "111111";
    pendingOtps.set(phone, { code: bypassOtp, expiresAt });
    console.log('\n' + '='.repeat(50));
    console.log(`  📱 CIKKA DEV BYPASS USER DETECTED (${phoneRaw})`);
    console.log(`  Phone : ${phone}`);
    console.log(`  ZERO REQUESTS TO MSG91 (Bypass active)`);
    console.log(`  OTP Bypass Code: ${bypassOtp}`);
    console.log(`  PAN Bypass Code: AAAAA1111A`);
    console.log('='.repeat(50) + '\n');
    return {
      otp: bypassOtp,
      isDev: true,
      isExistingUser: false,
      isVerified: false,
    };
  }

  // MOBILE APP DEV PHASE: Completely bypass MSG91 gateway for ANY phone number.
  // Real seller dashboard continues to use MSG91 for seller onboarding/logins.
  const bypassOtp = "111111";
  const otp = bypassOtp;

  // Prune expired OTP entries
  const now = new Date();
  for (const [key, value] of pendingOtps.entries()) {
    if (value.expiresAt < now) {
      pendingOtps.delete(key);
    }
  }

  // Store OTP in transient cache store
  pendingOtps.set(phone, { code: otp, expiresAt });

  // Check if user already exists and has completed PAN onboarding (has name and verified)
  let isExistingUser = false;
  let isVerified = false;
  try {
    const existing = await prisma.user.findUnique({ where: { phone } });
    isExistingUser = Boolean(existing && (existing.phoneVerified || existing.name));
    isVerified = Boolean(existing && existing.panVerified && existing.name && existing.name !== 'DEV BYPASS USER');
  } catch (_e) {
    // If DB check fails in dev/test, fallback cleanly
  }

  // Ensure user record exists via upsert
  try {
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });
  } catch (err: any) {
    if (config.isProduction) throw err;
    console.warn(`[DB Warning] User upsert skipped in dev mode: ${err.message}`);
  }

  // Log clearly that MSG91 is 100% bypassed
  console.log('\n' + '='.repeat(50));
  console.log(`  📱 CIKKA MOBILE APP USER AUTH (MSG91 100% BYPASSED)`);
  console.log(`  Phone : ${phone}`);
  console.log(`  OTP   : ${otp} (Zero MSG91 requests sent)`);
  console.log('='.repeat(50) + '\n');

  return {
    otp,
    devOtp: otp,
    isDev: true,
    isExistingUser,
    isVerified,
  };
}

export async function resendUserOtpService(phoneRaw: string, retryType: "text" | "voice" = "text") {
  const { phone } = normalizePhone(phoneRaw);
  const otp = "111111";
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  pendingOtps.set(phone, { code: otp, expiresAt });

  console.log('\n' + '='.repeat(50));
  console.log(`  📱 CIKKA MOBILE APP RESEND OTP (MSG91 100% BYPASSED)`);
  console.log(`  Phone : ${phone}`);
  console.log(`  OTP   : ${otp} (Zero MSG91 requests sent)`);
  console.log('='.repeat(50) + '\n');

  return {
    otp,
    devOtp: otp,
    isDev: true,
    message: "Dev OTP: 111111 (Zero MSG91 requests sent)",
  };
}



export async function verifyUserOtpService(phoneRaw: string, otp: string) {
  const { phone } = normalizePhone(phoneRaw);
  const pending = pendingOtps.get(phone);

  const isDevCode =
    ["111111", "123456", "1234", "1111", "000000", "482910"].includes(otp);

  let isValid = false;

  // 1. Any known dev bypass code
  if (isDevCode) {
    isValid = true;
  }

  // 2. Check in-memory pending OTP
  if (!isValid && pending && isOtpValid(pending.code, otp, pending.expiresAt)) {
    isValid = true;
  }

  // 3. In mobile app dev phase, accept any valid 4-6 digit numeric OTP gracefully
  // Zero calls to MSG91 verify API!
  if (!isValid && /^\d{4,6}$/.test(otp)) {
    console.log(`[Dev Auth Notice] Accepting valid numeric OTP ${otp} (MSG91 verify bypassed) for ${phone}`);
    isValid = true;
  }

  if (!isValid) {
    throw new Error(AUTH_ERRORS.INVALID_OTP);
  }

  // Clear OTP state
  pendingOtps.delete(phone);

  let isExistingUser = false;
  let isVerified = false;
  let updatedUser = {
    id: `user_${Date.now()}`,
    phone,
    name: null as string | null,
    email: null as string | null,
    panVerified: false,
    panNumber: null as string | null,
    profilePic: null as string | null,
  };

  try {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing && existing.phoneVerified) {
      isExistingUser = true;
    }

    const dbUser = await prisma.user.upsert({
      where: { phone },
      update: { phoneVerified: true },
      create: { phone, phoneVerified: true },
    });

    isVerified = Boolean(dbUser.panVerified && dbUser.name && dbUser.name !== 'DEV BYPASS USER');
    await grantSignupBonus(dbUser.id);
    updatedUser = {
      id: dbUser.id,
      phone: dbUser.phone,
      name: dbUser.name,
      email: dbUser.email,
      panVerified: dbUser.panVerified,
      panNumber: dbUser.panNumber,
      profilePic: dbUser.profilePic,
    };
  } catch (err: any) {
    if (config.isProduction) throw err;
    console.warn(`[DB Warning] User verify upsert skipped in dev mode: ${err.message}`);
  }

  // Generate Mobile App User Token with role "user" and audience "cikka-mobile-app"
  const token = signUserToken(updatedUser.id);

  return {
    token,
    user: updatedUser,
    isExistingUser,
    isVerified,
  };
}

/**
 * One-time sign-up bonus (SIGNUP_BONUS_POINTS, default 0 = none), credited through the
 * ledger with idempotency key EARN_SIGNUP:<userId>, so it is granted at most once per user
 * however many times they verify an OTP. New users otherwise start with 0 CI Points.
 */
export async function grantSignupBonus(userId: string): Promise<void> {
  const points = Math.floor(Number(process.env.SIGNUP_BONUS_POINTS || 0));
  if (!Number.isFinite(points) || points <= 0) return;
  try {
    await walletService.creditPoints(userId, points, WalletTxType.EARN_SIGNUP, {
      idempotencyKey: `EARN_SIGNUP:${userId}`,
      description: "Welcome bonus",
    });
  } catch (err: any) {
    console.warn(`[Signup Bonus Notice] ${userId}: ${err.message}`);
  }
}

export async function getUserProfileService(userId: string) {
  let user = null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        phoneVerified: true,
        panVerified: true,
        panNumber: true,
        profilePic: true,
        createdAt: true,
      },
    });
  } catch (_e) {}

  if (!user) {
    // In development mode, fallback to dev user profile
    return {
      id: userId,
      phone: "+911111111111",
      name: "Cikka Member",
      email: null,
      phoneVerified: true,
      panVerified: true,
      panNumber: "AAAAA1111A",
      profilePic: null,
      createdAt: new Date(),
    };
  }

  return user;
}

export async function updateUserProfileService(
  userId: string,
  data: { name?: string; email?: string; profilePic?: string | null }
) {
  try {
    const user = await prisma.user.upsert({
      where: { id: userId },
      update: data,
      create: {
        id: userId,
        phone: "+911111111111",
        name: data.name || "Cikka Member",
        email: data.email || null,
        phoneVerified: true,
        panVerified: true,
        profilePic: data.profilePic || null,
      },
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        phoneVerified: true,
        panVerified: true,
        panNumber: true,
        profilePic: true,
        createdAt: true,
      },
    });

    return user;
  } catch (err: any) {
    // Graceful fallback for mock sessions
    return {
      id: userId,
      phone: "+911111111111",
      name: data.name || "Cikka Member",
      email: data.email || null,
      phoneVerified: true,
      panVerified: true,
      panNumber: null,
      profilePic: data.profilePic || null,
      createdAt: new Date(),
    };
  }
}