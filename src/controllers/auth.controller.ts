import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { signToken } from "../utils/jwt";
import { asyncHandler } from "../utils/asyncHandler";
import { otpService } from "../external";
import { generateOtp, isOtpValid, hashPassword, checkPassword } from "../services/auth.service";

// ==========================================
// SIGNUP FLOW (5 Steps)
// ==========================================

export const signupSendPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body;

  let seller = await prisma.seller.findUnique({ where: { phone } });
  if (seller && seller.onboardingStatus !== "INCOMPLETE") {
    res.status(400).json({ error: "Phone number already registered" });
    return;
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  if (!seller) {
    seller = await prisma.seller.create({
      data: {
        phone,
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      },
    });
  } else {
    seller = await prisma.seller.update({
      where: { phone },
      data: {
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      },
    });
  }

  await otpService.sendSms(phone, otp);
  res.json({ message: "OTP sent" });
});

export const signupVerifyPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, otp } = req.body;

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  if (!isOtpValid(seller.phoneOtpCode, otp, seller.phoneOtpExpiresAt)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      phoneVerified: true,
      phoneOtpCode: null,
      phoneOtpExpiresAt: null,
    },
  });

  // Issue a temporary token for the rest of the signup flow
  const signupToken = signToken(seller.id, "1h");
  res.json({ message: "Phone verified", signupToken });
});

export const signupSendEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { email } = req.body;

  const existing = await prisma.seller.findUnique({ where: { email } });
  if (existing && existing.id !== sellerId) {
    res.status(400).json({ error: "Email already in use by another account" });
    return;
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      email,
      emailOtpCode: otp,
      emailOtpExpiresAt: expiresAt,
    },
  });

  await otpService.sendEmail(email, otp);
  res.json({ message: "OTP sent to email" });
});

export const signupVerifyEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { email, otp } = req.body;

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller || seller.email !== email) {
    res.status(400).json({ error: "Email mismatch or seller not found" });
    return;
  }

  if (!isOtpValid(seller.emailOtpCode, otp, seller.emailOtpExpiresAt)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      emailVerified: true,
      emailOtpCode: null,
      emailOtpExpiresAt: null,
    },
  });

  res.json({ message: "Email verified" });
});

export const signupSetPassword = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { password } = req.body;

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller || !seller.phoneVerified || !seller.emailVerified) {
    res.status(400).json({ error: "Phone and email must be verified first" });
    return;
  }

  const hash = await hashPassword(password);
  await prisma.seller.update({
    where: { id: sellerId },
    data: { passwordHash: hash },
  });

  // Issue final session token
  const token = signToken(seller.id);
  res.json({
    token,
    seller: {
      id: seller.id,
      phone: seller.phone,
      email: seller.email,
      onboardingStatus: seller.onboardingStatus,
    },
  });
});

// ==========================================
// SIGNIN FLOW (Phone OTP)
// ==========================================

export const signinSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body;

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ error: "Phone number not registered" });
    return;
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.seller.update({
    where: { phone },
    data: {
      phoneOtpCode: otp,
      phoneOtpExpiresAt: expiresAt,
    },
  });

  await otpService.sendSms(phone, otp);
  res.json({ message: "OTP sent" });
});

export const signinVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, otp } = req.body;

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  if (!isOtpValid(seller.phoneOtpCode, otp, seller.phoneOtpExpiresAt)) {
    res.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      phoneOtpCode: null,
      phoneOtpExpiresAt: null,
    },
  });

  const token = signToken(seller.id);
  res.json({
    token,
    seller: {
      id: seller.id,
      phone: seller.phone,
      email: seller.email,
      businessName: seller.businessName,
      kycVerified: seller.kycVerified,
      onboardingStatus: seller.onboardingStatus,
    },
  });
});

// ==========================================
// FORGOT PASSWORD FLOW
// ==========================================

export const forgotPasswordSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body;

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.seller.update({
    where: { phone },
    data: {
      resetOtpCode: otp,
      resetOtpExpiresAt: expiresAt,
    },
  });

  await otpService.sendSms(phone, otp);
  res.json({ message: "OTP sent" });
});

export const forgotPasswordVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, otp } = req.body;

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (!isOtpValid(seller.resetOtpCode, otp, seller.resetOtpExpiresAt)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      resetOtpCode: null,
      resetOtpExpiresAt: null,
    },
  });

  // Issue a reset token valid for 15 mins
  const resetToken = signToken(seller.id, "15m");
  res.json({ message: "OTP verified", resetToken });
});

export const forgotPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { password } = req.body;

  const hash = await hashPassword(password);
  await prisma.seller.update({
    where: { id: sellerId },
    data: { passwordHash: hash },
  });

  res.json({ message: "Password reset successfully" });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const seller = await prisma.seller.findUnique({
    where: { id: req.seller!.id },
    include: { onboarding: true },
  });
  
  if (!seller) {
    res.status(404).json({ error: "Seller not found" });
    return;
  }

  res.json({
    id: seller.id,
    phone: seller.phone,
    email: seller.email,
    businessName: seller.businessName,
    kycVerified: seller.kycVerified,
    onboardingStatus: seller.onboardingStatus,
    onboarding: seller.onboarding,
  });
});

// ==========================================
// PASSWORD LOGIN (loginId + password)
// ==========================================

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { loginId, password } = req.body;

  const seller = await prisma.seller.findFirst({
    where: {
      OR: [
        { loginId },
        { phone: loginId },
        { email: loginId },
      ],
    },
  });

  if (!seller || !seller.passwordHash) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await checkPassword(password, seller.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken(seller.id);
  res.json({
    token,
    seller: {
      id: seller.id,
      loginId: seller.loginId,
      phone: seller.phone,
      email: seller.email,
      businessName: seller.businessName,
      kycVerified: seller.kycVerified,
      onboardingStatus: seller.onboardingStatus,
    },
  });
});
