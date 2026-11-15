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

export async function getUserProfileService(userId: string) {
  let user = await prisma.user.findUnique({
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
      ciPoints: true,
      cashbackBalance: true,
      wallet: {
        select: {
          ciPoints: true,
          cashPaise: true,
        },
      },
      createdAt: true,
    },
  });

  if (!user) {
    // Auto-heal missing user records (e.g. dev-bypass-1 or stale session token)
    const isDev = userId === "dev-bypass-1" || userId === "dev-bypass-user-id" || userId.startsWith("user_") || userId.startsWith("dev-");
    const fallbackPhone = (userId === "dev-bypass-1" || userId === "dev-bypass-user-id")
      ? "+911111111111"
      : `+91${userId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`;

    try {
      user = await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          phone: fallbackPhone,
          phoneVerified: true,
          name: isDev ? "DEV BYPASS USER" : null,
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
          ciPoints: true,
          cashbackBalance: true,
          wallet: {
            select: {
              ciPoints: true,
              cashPaise: true,
            },
          },
          createdAt: true,
        },
      });
    } catch (_upsertErr) {
      user = await prisma.user.findFirst({
        where: { phone: fallbackPhone },
        select: {
          id: true,
          phone: true,
          name: true,
          email: true,
          phoneVerified: true,
          panVerified: true,
          panNumber: true,
          profilePic: true,
          ciPoints: true,
          cashbackBalance: true,
          wallet: {
            select: {
              ciPoints: true,
              cashPaise: true,
            },
          },
          createdAt: true,
        },
      });
    }

    if (!user) {
      throw new Error(AUTH_ERRORS.USER_NOT_FOUND);
    }
  }

  // Authoritative balance from double-entry UserWallet takes precedence
  const effectiveCiPoints = user.wallet ? user.wallet.ciPoints : user.ciPoints;
  const effectiveCashback = user.wallet
    ? user.wallet.cashPaise / 100
    : Number(user.cashbackBalance);

  return {
    ...user,
    ciPoints: effectiveCiPoints,
    cashbackBalance: effectiveCashback,
  };
}

export async function updateUserProfileService(
  userId: string,
  data: { name?: string; email?: string; profilePic?: string | null }
) {
  // Check if the user exists by id
  let existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true },
  });

  if (!existing) {
    const isDev = userId === "dev-bypass-1" || userId === "dev-bypass-user-id" || userId.startsWith("user_") || userId.startsWith("dev-");
    const fallbackPhone = (userId === "dev-bypass-1" || userId === "dev-bypass-user-id")
      ? "+911111111111"
      : `+91${userId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`;

    // Try to find user by fallback phone
    existing = await prisma.user.findFirst({
      where: { phone: fallbackPhone },
      select: { id: true, phone: true },
    });

    if (!existing) {
      // Create the missing user record
      try {
        return await prisma.user.create({
          data: {
            id: userId,
            phone: fallbackPhone,
            phoneVerified: true,
            name: isDev ? (data.name || "DEV BYPASS USER") : data.name,
            ...data,
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
      } catch (_createErr) {
        // If creation raced or failed on phone constraint, find the user who holds that phone
        existing = await prisma.user.findFirst({
          where: { phone: fallbackPhone },
          select: { id: true, phone: true },
        });
        if (!existing) {
          throw new Error(AUTH_ERRORS.USER_NOT_FOUND);
        }
      }
    }
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data,
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
}