import { prisma } from "../config/prisma";
import { signUserToken } from "../utils/jwt";
import { generateOtp, isOtpValid } from "./auth.service";
import { normalizePhone } from "../utils/phone";
import { otpService } from "../external";
import { AUTH_ERRORS } from "../constants/errors";
import { config } from "../config/env";

// In-memory OTP store for transient verification (production uses Redis/Cache)
const pendingOtps = new Map<string, { code: string; expiresAt: Date }>();


export async function sendUserOtpService(phoneRaw: string) {
  const { phone } = normalizePhone(phoneRaw);
  const otp = generateOtp(4);
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

  // Ensure user record exists via upsert
  await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  // Send OTP via configured SMS Gateway (MSG91)
  try {
    await otpService.sendSms(phone, otp);
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

  const isDev = !config.isProduction && !config.isRealExternalServices;
  return {
    otp,
    isDev,
  };
}


export async function verifyUserOtpService(phoneRaw: string, otp: string) {
  const { phone } = normalizePhone(phoneRaw);
  const pending = pendingOtps.get(phone);

  if (!pending) {
    throw new Error(AUTH_ERRORS.NO_PENDING_OTP);
  }

  if (!isOtpValid(pending.code, otp, pending.expiresAt)) {
    throw new Error(AUTH_ERRORS.INVALID_OTP);
  }

  // Clear OTP state
  pendingOtps.delete(phone);

  // Update phoneVerified on user safely via upsert/update
  const updatedUser = await prisma.user.upsert({
    where: { phone },
    update: { phoneVerified: true },
    create: { phone, phoneVerified: true },
  });

  // Generate Mobile App User Token with role "user" and audience "cikka-mobile-app"
  const token = signUserToken(updatedUser.id);

  return {
    token,
    user: {
      id: updatedUser.id,
      phone: updatedUser.phone,
      name: updatedUser.name,
      email: updatedUser.email,
    },
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
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error(AUTH_ERRORS.USER_NOT_FOUND);
  }

  return user;
}
