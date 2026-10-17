import { Request, Response } from "express";
import { OnboardingStatus } from "../generated/prisma/client";
import { prisma } from "../config/prisma";
import { AUTH_ERRORS } from "../constants/errors";
import { otpService } from "../external";
import { generateOtp, hashPassword, isOtpValid } from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { signToken } from "../utils/jwt";
import { normalizePhone } from "../utils/phone";

// ==========================================
// SIGNUP FLOW (5 Steps)
// ==========================================

export const signupSendPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  const existingSeller = await prisma.seller.findUnique({ where: { phone } });
  if (existingSeller && existingSeller.onboardingStatus !== OnboardingStatus.INCOMPLETE && existingSeller.phoneVerified) {
    res.status(400).json({ success: false, error: "Phone number already registered" });
    return;
  }

  const existingTeamMember = await prisma.teamMember.findFirst({ where: { phone, status: "ACTIVE" } });
  if (existingTeamMember) {
    res.status(400).json({ success: false, error: "This mobile number is registered as a team member. Please use the Sign In page to access your team dashboard." });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

  await prisma.seller.upsert({
    where: { phone },
    update: {
      countryCode,
      phoneNumber,
      phoneOtpCode: otp,
      phoneOtpExpiresAt: expiresAt,
    },
    create: {
      phone,
      countryCode,
      phoneNumber,
      phoneOtpCode: otp,
      phoneOtpExpiresAt: expiresAt,
      onboardingStatus: OnboardingStatus.INCOMPLETE,
    },
  });

  await otpService.sendSms(phone, otp, "seller_signup");
  res.json({ success: true, message: "OTP sent" });
});

export const signupVerifyPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;
  const { phone } = normalizePhone(phoneRaw);

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  if (!isOtpValid(seller.phoneOtpCode || null, otp, seller.phoneOtpExpiresAt || null)) {
    res.status(400).json({ success: false, error: AUTH_ERRORS.INVALID_OTP });
    return;
  }

  const updatedSeller = await prisma.seller.update({
    where: { phone },
    data: {
      phoneVerified: true,
      phoneOtpCode: null,
      phoneOtpExpiresAt: null,
    },
  });

  // Issue a temporary token for the rest of the signup flow
  const signupToken = signToken(updatedSeller.id, "1h");
  res.json({ success: true, message: "Phone verified", signupToken });
});

export const signupSendEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { email } = req.body;

  const existingEmailSeller = await prisma.seller.findUnique({ where: { email } });
  if (existingEmailSeller && existingEmailSeller.id !== sellerId) {
    res.status(400).json({ success: false, error: "Please use signin instead" });
    return;
  }

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const otp = generateOtp(6);
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
  res.json({ success: true, message: "OTP sent to email" });
});

export const signupVerifyEmailOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { email, otp } = req.body;

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller || seller.email !== email) {
    res.status(400).json({ success: false, error: "Email mismatch or seller not found" });
    return;
  }

  if (!isOtpValid(seller.emailOtpCode || null, otp, seller.emailOtpExpiresAt || null)) {
    res.status(400).json({ success: false, error: AUTH_ERRORS.INVALID_OTP });
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

  res.json({ success: true, message: "Email verified" });
});

export const signupSetPassword = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { password } = req.body;

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const hash = await hashPassword(password);
  const updatedSeller = await prisma.seller.update({
    where: { id: sellerId },
    data: {
      passwordHash: hash,
    },
  });

  // Issue final session token
  const token = signToken(updatedSeller.id);
  res.json({
    success: true,
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
      merchantAgreementAccepted: false,
      agreementAccepted: false,
      role: "ADMIN",
    },
  });
});

// ==========================================
// SIGNIN FLOW (Phone OTP)
// ==========================================

export const signinSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  const seller = await prisma.seller.findUnique({ where: { phone } });
  const teamMember = await prisma.teamMember.findFirst({ where: { phone, status: "ACTIVE" } });

  if (!seller && !teamMember) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // If they have an active team member invite/membership and do not have their own verified business, prefer team member
  if (teamMember && (!seller || seller.onboardingStatus !== "VERIFIED")) {
    await prisma.teamMember.updateMany({
      where: { phone, status: "ACTIVE" },
      data: {
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      },
    });
  } else if (seller) {
    await prisma.seller.update({
      where: { phone },
      data: {
        countryCode,
        phoneNumber,
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      },
    });
  }

  await otpService.sendSms(phone, otp, "seller_login");
  res.json({ success: true, message: "OTP sent" });
});

export const signinVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;
  const { phone } = normalizePhone(phoneRaw);

  const seller = await prisma.seller.findUnique({ where: { phone } });
  const teamMember = await prisma.teamMember.findFirst({ where: { phone, status: "ACTIVE" } });

  if (!seller && !teamMember) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  if (teamMember && (!seller || seller.onboardingStatus !== "VERIFIED")) {
    if (!isOtpValid(teamMember.phoneOtpCode || null, otp, teamMember.phoneOtpExpiresAt || null)) {
      res.status(401).json({ success: false, error: AUTH_ERRORS.INVALID_OTP });
      return;
    }

    await prisma.teamMember.updateMany({
      where: { phone },
      data: {
        phoneOtpCode: null,
        phoneOtpExpiresAt: null,
      },
    });

    // Fetch the parent seller
    const parentSeller = await prisma.seller.findUnique({
      where: { id: teamMember.sellerId },
      include: { onboarding: true },
    });

    if (!parentSeller) {
      res.status(404).json({ success: false, error: "Associated business not found" });
      return;
    }

    const token = signToken(teamMember.sellerId, undefined, teamMember.id);
    res.json({
      success: true,
      token,
      seller: {
        id: parentSeller.id,
        phone: teamMember.phone,
        countryCode: parentSeller.countryCode,
        phoneNumber: teamMember.phone.replace(/^\+91/, ""),
        email: teamMember.email || parentSeller.email,
        businessName: parentSeller.businessName || parentSeller.onboarding?.businessName || "",
        logoUrl: parentSeller.onboarding?.logoUrl || null,
        kycVerified: true,
        onboardingStatus: "VERIFIED",
        merchantAgreementAccepted: true,
        agreementAccepted: true,
        isTeamMember: true,
        role: teamMember.role,
        canViewFinancials: Boolean(teamMember.canViewFinancials),
        teamMemberId: teamMember.id,
        memberName: teamMember.name,
        memberPhone: teamMember.phone,
        memberEmail: teamMember.email || "",
      },
    });
    return;
  } else if (seller) {
    if (!isOtpValid(seller.phoneOtpCode || null, otp, seller.phoneOtpExpiresAt || null)) {
      res.status(401).json({ success: false, error: AUTH_ERRORS.INVALID_OTP });
      return;
    }

    const updatedSeller = await prisma.seller.update({
      where: { phone },
      data: {
        phoneOtpCode: null,
        phoneOtpExpiresAt: null,
      },
      include: {
        onboarding: true,
      },
    });

    const isDoneAgreement = Boolean(
      updatedSeller.onboarding?.merchantAgreementAccepted && updatedSeller.onboarding?.digitalSignature
    );

    const token = signToken(updatedSeller.id);
    res.json({
      success: true,
      token,
      seller: {
        id: updatedSeller.id,
        phone: updatedSeller.phone,
        countryCode: updatedSeller.countryCode,
        phoneNumber: updatedSeller.phoneNumber,
        email: updatedSeller.email,
        businessName: updatedSeller.businessName || updatedSeller.onboarding?.businessName || "",
        logoUrl: updatedSeller.onboarding?.logoUrl || null,
        kycVerified: updatedSeller.kycVerified,
        onboardingStatus: updatedSeller.onboardingStatus,
        merchantAgreementAccepted: isDoneAgreement,
        agreementAccepted: isDoneAgreement,
        role: "ADMIN",
        isTeamMember: false,
        memberName: updatedSeller.onboarding?.signatoryName || updatedSeller.businessName || "Store Owner",
        memberPhone: updatedSeller.phone,
      },
    });
    return;
  }
});


import bcrypt from "bcryptjs";

export const sellerLogin = asyncHandler(async (req: Request, res: Response) => {
  const { loginId, phone: phoneInput, password } = req.body;
  const rawPhone = phoneInput || loginId;

  if (!rawPhone || !password) {
    res.status(400).json({ success: false, error: "Phone/Login ID and password are required" });
    return;
  }

  let normPhone = rawPhone;
  let normNumber = rawPhone;
  try {
    const normalized = normalizePhone(rawPhone);
    normPhone = normalized.phone;
    normNumber = normalized.phoneNumber;
  } catch (e) {
    // Keep rawPhone if normalization fails
  }

  const seller = await prisma.seller.findFirst({
    where: {
      OR: [
        { phone: rawPhone },
        { phone: normPhone },
        { phoneNumber: normNumber },
        { phoneNumber: rawPhone },
        { email: rawPhone },
      ],
    },
    include: {
      onboarding: true,
    },
  });


  if (!seller || !seller.passwordHash) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  const isMatch = await bcrypt.compare(password, seller.passwordHash);
  if (!isMatch) {
    res.status(401).json({ success: false, error: "Invalid credentials" });
    return;
  }

  const isDoneAgreement = Boolean(
    seller.onboarding?.merchantAgreementAccepted && seller.onboarding?.digitalSignature
  );

  const token = signToken(seller.id);
  res.json({
    success: true,
    token,
    seller: {
      id: seller.id,
      phone: seller.phone,
      email: seller.email,
      businessName: seller.businessName || seller.onboarding?.businessName || "",
      logoUrl: seller.onboarding?.logoUrl || null,
      kycVerified: seller.kycVerified,
      onboardingStatus: seller.onboardingStatus,
      merchantAgreementAccepted: isDoneAgreement,
      agreementAccepted: isDoneAgreement,
      role: "ADMIN",
      isTeamMember: false,
      memberName: seller.onboarding?.signatoryName || seller.businessName || "Store Owner",
      memberPhone: seller.phone,
    },
  });
});


export const resendSellerOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, retryType = "text", purpose = "signin" } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  const existingSeller = await prisma.seller.findUnique({ where: { phone } });
  const teamMember = await prisma.teamMember.findFirst({ where: { phone, status: "ACTIVE" } });

  if (!existingSeller && !teamMember && purpose !== "signup") {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  if (teamMember && (!existingSeller || existingSeller.onboardingStatus !== "VERIFIED") && purpose === "signin") {
    await prisma.teamMember.updateMany({
      where: { phone, status: "ACTIVE" },
      data: {
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      },
    });
  } else {
    const updateData: any =
      purpose === "reset"
        ? { resetOtpCode: otp, resetOtpExpiresAt: expiresAt }
        : { phoneOtpCode: otp, phoneOtpExpiresAt: expiresAt };

    if (existingSeller) {
      await prisma.seller.update({
        where: { phone },
        data: {
          countryCode,
          phoneNumber,
          ...updateData,
        },
      });
    } else {
      await prisma.seller.create({
        data: {
          phone,
          countryCode,
          phoneNumber,
          onboardingStatus: OnboardingStatus.INCOMPLETE,
          ...updateData,
        },
      });
    }
  }

  const resendResult = await otpService.resendSms(phone, retryType as "text" | "voice");
  res.json({ success: true, message: resendResult.message || "OTP resent successfully" });
});

// ==========================================
// FORGOT PASSWORD FLOW
// ==========================================

export const forgotPasswordSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { phone, countryCode, phoneNumber } = normalizePhone(phoneRaw);

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.seller.update({
    where: { phone },
    data: {
      countryCode,
      phoneNumber,
      resetOtpCode: otp,
      resetOtpExpiresAt: expiresAt,
    },
  });

  await otpService.sendSms(phone, otp, "seller_login");
  res.json({ success: true, message: "OTP sent" });
});

export const forgotPasswordVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;
  const { phone } = normalizePhone(phoneRaw);

  const seller = await prisma.seller.findUnique({ where: { phone } });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  if (!isOtpValid(seller.resetOtpCode || null, otp, seller.resetOtpExpiresAt || null)) {
    res.status(400).json({ success: false, error: AUTH_ERRORS.INVALID_OTP });
    return;
  }

  const updatedSeller = await prisma.seller.update({
    where: { phone },
    data: {
      resetOtpCode: null,
      resetOtpExpiresAt: null,
    },
  });

  // Issue a reset token valid for 15 mins
  const resetToken = signToken(updatedSeller.id, "15m");
  res.json({ success: true, message: "OTP verified", resetToken });
});

export const forgotPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { password } = req.body;

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const hash = await hashPassword(password);
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      passwordHash: hash,
    },
  });

  res.json({ success: true, message: "Password reset successfully" });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const teamMemberId = req.seller!.teamMemberId;

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: { onboarding: true },
  });
  if (!seller) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  let role = "ADMIN";
  let isTeamMember = false;
  let memberName = seller.onboarding?.signatoryName || seller.businessName || "Store Owner";
  let memberPhone = seller.phone;
  let memberEmail = seller.email || "";

  let canViewFinancials = false;

  if (teamMemberId) {
    const teamMember = await prisma.teamMember.findUnique({ where: { id: teamMemberId } });
    if (teamMember) {
      role = teamMember.role;
      isTeamMember = true;
      memberName = teamMember.name;
      memberPhone = teamMember.phone;
      memberEmail = teamMember.email || "";
      canViewFinancials = Boolean(teamMember.canViewFinancials);
    }
  }

  const isDoneAgreement = Boolean(
    seller.onboarding?.merchantAgreementAccepted && seller.onboarding?.digitalSignature
  );

  res.json({
    success: true,
    seller: {
      id: seller.id,
      phone: memberPhone,
      countryCode: seller.countryCode,
      phoneNumber: memberPhone.replace(/^\+91/, ""),
      email: memberEmail || seller.email,
      businessName: seller.businessName || seller.onboarding?.businessName || "",
      logoUrl: seller.onboarding?.logoUrl || null,
      kycVerified: isTeamMember ? true : seller.kycVerified,
      onboardingStatus: isTeamMember ? "VERIFIED" : seller.onboardingStatus,
      merchantAgreementAccepted: isTeamMember ? true : isDoneAgreement,
      agreementAccepted: isTeamMember ? true : isDoneAgreement,
      isTeamMember,
      role,
      canViewFinancials,
      teamMemberId,
      memberName,
      memberPhone,
      memberEmail,
    },
  });
});
