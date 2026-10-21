import { config } from "../config/env";
import { prisma } from "../config/prisma";
import { AUTH_ERRORS } from "../constants/errors";
import { otpService } from "../external";
import { signUserToken } from "../utils/jwt";
import { normalizePhone } from "../utils/phone";
import { generateOtp, isOtpValid } from "./auth.service";

// In-memory OTP store for transient verification (production uses Redis/Cache)
const pendingOtps = new Map<string, { code: string; expiresAt: Date }>();


export async function sendUserOtpService(phoneRaw: string) {
  const { phone } = normalizePhone(phoneRaw);
  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

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

  const templateType = isExistingUser ? "app_login" : "app_signup";

  // Send OTP via configured SMS Gateway (MSG91)
  try {
    await otpService.sendSms(phone, otp, templateType);
  } catch (err: any) {
    if (config.isProduction) {
      throw err;
    }
    // Print OTP very clearly to the terminal for local testing
    console.log('\n' + '='.repeat(50));
    console.log(`  📱 CIKKA DEV OTP`);
    console.log(`  Phone : ${phone}`);
    console.log(`  OTP   : ${otp}`);
    console.log('='.repeat(50) + '\n');
  }

  // Print OTP very clearly to the terminal for local testing
  console.log('\n' + '='.repeat(50));
  console.log(`  📱 CIKKA DEV OTP GENERATED`);
  console.log(`  Phone : ${phone}`);
  console.log(`  OTP   : ${otp}  (Dev bypass: 111111)`);
  console.log('='.repeat(50) + '\n');

  const isDev = !config.isProduction;
  return {
    otp,
    isDev,
    isExistingUser,
    isVerified,
  };
}

export async function resendUserOtpService(phoneRaw: string, retryType: "text" | "voice" = "text") {
  const { phone } = normalizePhone(phoneRaw);
  let pending = pendingOtps.get(phone);

  let otp = pending?.code;
  if (!otp || (pending && pending.expiresAt < new Date())) {
    otp = generateOtp(6);
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  pendingOtps.set(phone, { code: otp, expiresAt });

  let resendResult: { success: boolean; message?: string } = { success: true, message: "OTP resent successfully" };
  try {
    resendResult = await otpService.resendSms(phone, retryType);
  } catch (err: any) {
    if (config.isProduction) {
      throw err;
    }
    console.log('\n' + '='.repeat(50));
    console.log(`  📱 CIKKA DEV RESEND OTP (${retryType})`);
    console.log(`  Phone : ${phone}`);
    console.log(`  OTP   : ${otp}`);
    console.log('='.repeat(50) + '\n');
  }

  const isDev = !config.isProduction && !config.isRealExternalServices;
  return {
    otp,
    isDev,
    message: resendResult.message || "OTP resent successfully",
  };
}



export async function verifyUserOtpService(phoneRaw: string, otp: string) {
  const { phone } = normalizePhone(phoneRaw);
  const pending = pendingOtps.get(phone);

  const isDevCode =
    !config.isProduction &&
    ["1234", "1111", "111111", "123456", "000000", "482910"].includes(otp);

  if (!pending && !isDevCode) {
    throw new Error(AUTH_ERRORS.NO_PENDING_OTP);
  }

  if (pending && !isDevCode && !isOtpValid(pending.code, otp, pending.expiresAt)) {
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
  const user = await prisma.user.findUnique({
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

  if (!user) {
    throw new Error(AUTH_ERRORS.USER_NOT_FOUND);
  }

  return user;
}

export async function updateUserProfileService(
  userId: string,
  data: { name?: string; email?: string; profilePic?: string | null }
) {
  const user = await prisma.user.update({
    where: { id: userId },
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