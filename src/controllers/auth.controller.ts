import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { otpService } from "../external";
import { generateOtp, hashPassword, isOtpValid } from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { signToken } from "../utils/jwt";
import { normalizePhone } from "../utils/phone";

// Fallback in-memory seller store for development mode if Prisma DB is unavailable
interface InMemSeller {
  id: string;
  phone: string;
  countryCode?: string;
  phoneNumber?: string;
  email?: string | null;
  phoneVerified?: boolean;
  emailVerified?: boolean;
  phoneOtpCode?: string | null;
  phoneOtpExpiresAt?: Date | null;
  emailOtpCode?: string | null;
  emailOtpExpiresAt?: Date | null;
  resetOtpCode?: string | null;
  resetOtpExpiresAt?: Date | null;
  passwordHash?: string | null;
  businessName?: string | null;
  kycVerified?: boolean;
  onboardingStatus?: string;
}

const memorySellers = new Map<string, InMemSeller>();

async function safeFindSellerByPhone(phone: string): Promise<InMemSeller | null> {
  try {
    const seller = await prisma.seller.findUnique({ where: { phone } });
    if (seller) return seller as InMemSeller;
  } catch (err: any) {
    console.warn(`[DB Warning] Prisma seller lookup by phone failed (${err.message}). Using in-memory auth store.`);
  }
  return memorySellers.get(phone) || null;
}

async function safeFindSellerById(id: string): Promise<InMemSeller | null> {
  try {
    const seller = await prisma.seller.findUnique({ where: { id } });
    if (seller) return seller as InMemSeller;
  } catch (err: any) {
    console.warn(`[DB Warning] Prisma seller lookup by id failed (${err.message}). Using in-memory auth store.`);
  }
  for (const s of memorySellers.values()) {
    if (s.id === id) return s;
  }
  return null;
}

async function safeFindSellerByEmail(email: string): Promise<InMemSeller | null> {
  try {
    const seller = await prisma.seller.findUnique({ where: { email } });
    if (seller) return seller as InMemSeller;
  } catch (err: any) {
    console.warn(`[DB Warning] Prisma seller lookup by email failed (${err.message}). Using in-memory auth store.`);
  }
  for (const s of memorySellers.values()) {
    if (s.email === email) return s;
  }
  return null;
}

async function safeUpsertSeller(phone: string, data: Partial<InMemSeller>): Promise<InMemSeller> {
  let existing = await safeFindSellerByPhone(phone);
  let updated: InMemSeller = {
    id: existing?.id || `seller_${Date.now()}`,
    phone,
    countryCode: data.countryCode || existing?.countryCode || "+91",
    phoneNumber: data.phoneNumber || existing?.phoneNumber || phone.replace("+91", ""),
    email: data.email !== undefined ? data.email : (existing?.email || null),
    phoneVerified: data.phoneVerified !== undefined ? data.phoneVerified : (existing?.phoneVerified || false),
    emailVerified: data.emailVerified !== undefined ? data.emailVerified : (existing?.emailVerified || false),
    phoneOtpCode: data.phoneOtpCode !== undefined ? data.phoneOtpCode : (existing?.phoneOtpCode || null),
    phoneOtpExpiresAt: data.phoneOtpExpiresAt !== undefined ? data.phoneOtpExpiresAt : (existing?.phoneOtpExpiresAt || null),
    emailOtpCode: data.emailOtpCode !== undefined ? data.emailOtpCode : (existing?.emailOtpCode || null),
    emailOtpExpiresAt: data.emailOtpExpiresAt !== undefined ? data.emailOtpExpiresAt : (existing?.emailOtpExpiresAt || null),
    resetOtpCode: data.resetOtpCode !== undefined ? data.resetOtpCode : (existing?.resetOtpCode || null),
    resetOtpExpiresAt: data.resetOtpExpiresAt !== undefined ? data.resetOtpExpiresAt : (existing?.resetOtpExpiresAt || null),
    passwordHash: data.passwordHash !== undefined ? data.passwordHash : (existing?.passwordHash || null),
    businessName: data.businessName !== undefined ? data.businessName : (existing?.businessName || "Default Store"),
    kycVerified: data.kycVerified !== undefined ? data.kycVerified : (existing?.kycVerified || false),
    onboardingStatus: data.onboardingStatus || existing?.onboardingStatus || "INCOMPLETE",
  };

  try {
    if (existing && existing.id) {
      await prisma.seller.update({ where: { phone }, data: data as any });
    } else {
      await prisma.seller.create({ data: { phone, ...data } as any });
    }
  } catch (err: any) {
    console.warn(`[DB Warning] Prisma seller save failed (${err.message}). Preserved in-memory seller.`);
  }

  memorySellers.set(phone, updated);
  return updated;
}

// ==========================================
// SIGNUP FLOW (5 Steps)
// ==========================================

export const signupSendPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  let seller = await safeFindSellerByPhone(phone);
  if (seller && seller.onboardingStatus !== "INCOMPLETE" && seller.phoneVerified) {
    res.status(400).json({ error: "Phone number already registered" });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  seller = await safeUpsertSeller(phone, {
    countryCode,
    phoneNumber,
    phoneOtpCode: otp,
    phoneOtpExpiresAt: expiresAt,
  });

  await otpService.sendSms(phone, otp);
  res.json({ message: "OTP sent" });
});

export const signupVerifyPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;
  const { phone } = normalizePhone(phoneRaw);

  const seller = await safeFindSellerByPhone(phone);
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  if (!isOtpValid(seller.phoneOtpCode || null, otp, seller.phoneOtpExpiresAt || null)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  const updatedSeller = await safeUpsertSeller(phone, {
    phoneVerified: true,
    phoneOtpCode: null,
    phoneOtpExpiresAt: null,
  });

  // Issue a temporary token for the rest of the signup flow
  const signupToken = signToken(updatedSeller.id, "1h");
  res.json({ message: "Phone verified", signupToken });
});

export const signupSendEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { email } = req.body;

  const existing = await safeFindSellerByEmail(email);
  if (existing && existing.id !== sellerId) {
    res.status(400).json({ error: "Email already in use by another account" });
    return;
  }

  const seller = await safeFindSellerById(sellerId);
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await safeUpsertSeller(seller.phone, {
    email,
    emailOtpCode: otp,
    emailOtpExpiresAt: expiresAt,
  });

  await otpService.sendEmail(email, otp);
  res.json({ message: "OTP sent to email" });
});

export const signupVerifyEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { email, otp } = req.body;

  const seller = await safeFindSellerById(sellerId);
  if (!seller || seller.email !== email) {
    res.status(400).json({ error: "Email mismatch or seller not found" });
    return;
  }

  if (!isOtpValid(seller.emailOtpCode || null, otp, seller.emailOtpExpiresAt || null)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  await safeUpsertSeller(seller.phone, {
    emailVerified: true,
    emailOtpCode: null,
    emailOtpExpiresAt: null,
  });

  res.json({ message: "Email verified" });
});

export const signupSetPassword = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { password } = req.body;

  const seller = await safeFindSellerById(sellerId);
  if (!seller) {
    res.status(400).json({ error: "Seller not found" });
    return;
  }

  const hash = await hashPassword(password);
  const updatedSeller = await safeUpsertSeller(seller.phone, {
    passwordHash: hash,
  });

  // Issue final session token
  const token = signToken(updatedSeller.id);
  res.json({
    token,
    seller: {
      id: updatedSeller.id,
      phone: updatedSeller.phone,
      countryCode: updatedSeller.countryCode,
      phoneNumber: updatedSeller.phoneNumber,
      email: updatedSeller.email,
      onboardingStatus: updatedSeller.onboardingStatus,
    },
  });
});

// ==========================================
// SIGNIN FLOW (Phone OTP)
// ==========================================

export const signinSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  let seller = await safeFindSellerByPhone(phone);
  if (!seller) {
    // In dev mode, auto-create seller record if signing in for the first time
    seller = await safeUpsertSeller(phone, {
      countryCode,
      phoneNumber,
    });
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await safeUpsertSeller(phone, {
    countryCode,
    phoneNumber,
    phoneOtpCode: otp,
    phoneOtpExpiresAt: expiresAt,
  });

  await otpService.sendSms(phone, otp);
  res.json({ message: "OTP sent" });
});

export const signinVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;
  const { phone } = normalizePhone(phoneRaw);

  const seller = await safeFindSellerByPhone(phone);
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  if (!isOtpValid(seller.phoneOtpCode || null, otp, seller.phoneOtpExpiresAt || null)) {
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  const updatedSeller = await safeUpsertSeller(phone, {
    phoneOtpCode: null,
    phoneOtpExpiresAt: null,
  });

  const token = signToken(updatedSeller.id);
  res.json({
    token,
    seller: {
      id: updatedSeller.id,
      phone: updatedSeller.phone,
      countryCode: updatedSeller.countryCode,
      phoneNumber: updatedSeller.phoneNumber,
      email: updatedSeller.email,
      businessName: updatedSeller.businessName,
      kycVerified: updatedSeller.kycVerified,
      onboardingStatus: updatedSeller.onboardingStatus,
    },
  });
});

export const resendSellerOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, retryType = "text", purpose = "signin" } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  let seller = await safeFindSellerByPhone(phone);
  if (!seller && purpose !== "signup") {
    res.status(404).json({ error: "Seller account not found" });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const updateField =
    purpose === "reset"
      ? { resetOtpCode: otp, resetOtpExpiresAt: expiresAt }
      : { phoneOtpCode: otp, phoneOtpExpiresAt: expiresAt };

  await safeUpsertSeller(phone, {
    countryCode,
    phoneNumber,
    ...updateField,
  });

  const resendResult = await otpService.resendSms(phone, retryType as "text" | "voice");
  res.json({ message: resendResult.message || "OTP resent successfully" });
});

// ==========================================
// FORGOT PASSWORD FLOW
// ==========================================

export const forgotPasswordSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  const seller = await safeFindSellerByPhone(phone);
  if (!seller) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await safeUpsertSeller(phone, {
    countryCode,
    phoneNumber,
    resetOtpCode: otp,
    resetOtpExpiresAt: expiresAt,
  });

  await otpService.sendSms(phone, otp);
  res.json({ message: "OTP sent" });
});

export const forgotPasswordVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;
  const { phone } = normalizePhone(phoneRaw);

  const seller = await safeFindSellerByPhone(phone);
  if (!seller) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (!isOtpValid(seller.resetOtpCode || null, otp, seller.resetOtpExpiresAt || null)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  const updatedSeller = await safeUpsertSeller(phone, {
    resetOtpCode: null,
    resetOtpExpiresAt: null,
  });

  // Issue a reset token valid for 15 mins
  const resetToken = signToken(updatedSeller.id, "15m");
  res.json({ message: "OTP verified", resetToken });
});

export const forgotPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { password } = req.body;

  const seller = await safeFindSellerById(sellerId);
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  const hash = await hashPassword(password);
  await safeUpsertSeller(seller.phone, {
    passwordHash: hash,
  });

  res.json({ message: "Password reset successfully" });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const seller = await safeFindSellerById(req.seller!.id);
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  res.json({
    id: seller.id,
    phone: seller.phone,
    countryCode: seller.countryCode,
    phoneNumber: seller.phoneNumber,
    email: seller.email,
    businessName: seller.businessName,
    kycVerified: seller.kycVerified,
    onboardingStatus: seller.onboardingStatus,
  });
});
