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
  const teamMembers = await prisma.teamMember.findMany({ where: { phone, status: "ACTIVE" } });

  if (!seller && teamMembers.length === 0) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Set OTP across all matching active team memberships
  if (teamMembers.length > 0) {
    await prisma.teamMember.updateMany({
      where: { phone, status: "ACTIVE" },
      data: {
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      },
    });
  }

  // Set OTP on owned seller record if present
  if (seller) {
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

  const seller = await prisma.seller.findUnique({
    where: { phone },
    include: { onboarding: true },
  });
  const teamMembers = await prisma.teamMember.findMany({
    where: { phone, status: "ACTIVE" },
    include: {
      seller: {
        include: { onboarding: true },
      },
    },
  });

  if (!seller && teamMembers.length === 0) {
    res.status(404).json({ success: false, error: AUTH_ERRORS.USER_NOT_FOUND });
    return;
  }

  // Check if OTP matches either owned seller or team member OTP state
  const isSellerOtpValid = seller && isOtpValid(seller.phoneOtpCode || null, otp, seller.phoneOtpExpiresAt || null);
  const firstMatchingTm = teamMembers.find((tm) =>
    isOtpValid(tm.phoneOtpCode || null, otp, tm.phoneOtpExpiresAt || null)
  );

  if (!isSellerOtpValid && !firstMatchingTm) {
    res.status(401).json({ success: false, error: AUTH_ERRORS.INVALID_OTP });
    return;
  }

  // Clear OTP codes
  if (seller) {
    await prisma.seller.update({
      where: { phone },
      data: { phoneOtpCode: null, phoneOtpExpiresAt: null },
    }).catch(() => {});
  }
  if (teamMembers.length > 0) {
    await prisma.teamMember.updateMany({
      where: { phone },
      data: { phoneOtpCode: null, phoneOtpExpiresAt: null },
    }).catch(() => {});
  }

  // Build aggregated list of associated accounts
  const accounts: Array<{
    accountId: string;
    sellerId: string;
    teamMemberId?: string;
    companyName: string;
    logoUrl: string | null;
    role: string;
    isOwner: boolean;
    canViewFinancials: boolean;
    memberName: string;
    onboardingStatus: string;
    kycVerified: boolean;
  }> = [];

  if (seller) {
    accounts.push({
      accountId: `seller_${seller.id}`,
      sellerId: seller.id,
      companyName: seller.businessName || seller.onboarding?.businessName || "My Store",
      logoUrl: seller.onboarding?.logoUrl || null,
      role: "OWNER",
      isOwner: true,
      canViewFinancials: true,
      memberName: seller.onboarding?.signatoryName || seller.businessName || "Store Owner",
      onboardingStatus: seller.onboardingStatus,
      kycVerified: Boolean(seller.kycVerified || seller.onboardingStatus === "VERIFIED"),
    });
  }

  for (const tm of teamMembers) {
    if (tm.seller) {
      accounts.push({
        accountId: `tm_${tm.id}`,
        sellerId: tm.sellerId,
        teamMemberId: tm.id,
        companyName: tm.seller.businessName || tm.seller.onboarding?.businessName || "Company",
        logoUrl: tm.seller.onboarding?.logoUrl || null,
        role: tm.role,
        isOwner: false,
        canViewFinancials: Boolean(tm.canViewFinancials),
        memberName: tm.name,
        onboardingStatus: tm.seller.onboardingStatus || "VERIFIED",
        kycVerified: true,
      });
    }
  }

  // Select initial active account:
  // Prefer verified seller or first team member
  const primaryAccount =
    accounts.find((a) => a.isOwner && a.onboardingStatus === "VERIFIED") ||
    accounts[0];

  const token = signToken(primaryAccount.sellerId, undefined, primaryAccount.teamMemberId);

  // Build seller response format
  let activeSellerPayload: any = null;
  if (primaryAccount.isOwner && seller) {
    const isDoneAgreement = Boolean(
      seller.onboarding?.merchantAgreementAccepted && seller.onboarding?.digitalSignature
    );
    activeSellerPayload = {
      id: seller.id,
      phone: seller.phone,
      countryCode: seller.countryCode,
      phoneNumber: seller.phoneNumber,
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
      memberEmail: seller.email || "",
      canViewFinancials: true,
    };
  } else {
    const tmRecord = teamMembers.find((t) => t.id === primaryAccount.teamMemberId);
    const parent = tmRecord?.seller;
    activeSellerPayload = {
      id: parent?.id || primaryAccount.sellerId,
      phone: tmRecord?.phone || phone,
      countryCode: parent?.countryCode || "91",
      phoneNumber: (tmRecord?.phone || phone).replace(/^\+91/, ""),
      email: tmRecord?.email || parent?.email || "",
      businessName: parent?.businessName || parent?.onboarding?.businessName || primaryAccount.companyName,
      logoUrl: parent?.onboarding?.logoUrl || null,
      kycVerified: true,
      onboardingStatus: "VERIFIED",
      merchantAgreementAccepted: true,
      agreementAccepted: true,
      isTeamMember: true,
      role: tmRecord?.role || primaryAccount.role,
      canViewFinancials: Boolean(tmRecord?.canViewFinancials),
      teamMemberId: tmRecord?.id,
      memberName: tmRecord?.name,
      memberPhone: tmRecord?.phone,
      memberEmail: tmRecord?.email || "",
    };
  }

  res.json({
    success: true,
    token,
    seller: activeSellerPayload,
    accounts,
    hasMultipleAccounts: accounts.length > 1,
  });
});

export const switchAccount = asyncHandler(async (req: Request, res: Response) => {
  const { accountId, sellerId, teamMemberId } = req.body;
  const currentSellerId = req.seller?.id;
  const currentTmId = req.seller?.teamMemberId;

  if (!currentSellerId) {
    res.status(401).json({ success: false, error: AUTH_ERRORS.UNAUTHORIZED });
    return;
  }

  // Get current user's phone to verify authorization
  let userPhone: string | null = null;
  if (currentTmId) {
    const tm = await prisma.teamMember.findUnique({ where: { id: currentTmId } });
    userPhone = tm?.phone || null;
  } else {
    const s = await prisma.seller.findUnique({ where: { id: currentSellerId } });
    userPhone = s?.phone || null;
  }

  if (!userPhone) {
    res.status(401).json({ success: false, error: AUTH_ERRORS.UNAUTHORIZED });
    return;
  }

  // Verify target account ownership / membership
  let targetSellerId = sellerId;
  let targetTmId = teamMemberId;

  if (accountId) {
    if (accountId.startsWith("seller_")) {
      targetSellerId = accountId.replace("seller_", "");
      targetTmId = undefined;
    } else if (accountId.startsWith("tm_")) {
      targetTmId = accountId.replace("tm_", "");
    }
  }

  if (targetTmId) {
    const tm = await prisma.teamMember.findUnique({
      where: { id: targetTmId },
      include: { seller: { include: { onboarding: true } } },
    });

    if (!tm || tm.phone !== userPhone || tm.status !== "ACTIVE" || !tm.seller) {
      res.status(403).json({ success: false, error: "Access denied to requested organization" });
      return;
    }

    const token = signToken(tm.sellerId, undefined, tm.id);
    const sellerPayload = {
      id: tm.seller.id,
      phone: tm.phone,
      countryCode: tm.seller.countryCode,
      phoneNumber: tm.phone.replace(/^\+91/, ""),
      email: tm.email || tm.seller.email || "",
      businessName: tm.seller.businessName || tm.seller.onboarding?.businessName || "",
      logoUrl: tm.seller.onboarding?.logoUrl || null,
      kycVerified: true,
      onboardingStatus: "VERIFIED",
      merchantAgreementAccepted: true,
      agreementAccepted: true,
      isTeamMember: true,
      role: tm.role,
      canViewFinancials: Boolean(tm.canViewFinancials),
      teamMemberId: tm.id,
      memberName: tm.name,
      memberPhone: tm.phone,
      memberEmail: tm.email || "",
    };

    res.json({ success: true, token, seller: sellerPayload });
    return;
  } else if (targetSellerId) {
    const s = await prisma.seller.findUnique({
      where: { id: targetSellerId },
      include: { onboarding: true },
    });

    if (!s || s.phone !== userPhone) {
      res.status(403).json({ success: false, error: "Access denied to requested organization" });
      return;
    }

    const isDoneAgreement = Boolean(
      s.onboarding?.merchantAgreementAccepted && s.onboarding?.digitalSignature
    );

    const token = signToken(s.id);
    const sellerPayload = {
      id: s.id,
      phone: s.phone,
      countryCode: s.countryCode,
      phoneNumber: s.phoneNumber,
      email: s.email,
      businessName: s.businessName || s.onboarding?.businessName || "",
      logoUrl: s.onboarding?.logoUrl || null,
      kycVerified: s.kycVerified,
      onboardingStatus: s.onboardingStatus,
      merchantAgreementAccepted: isDoneAgreement,
      agreementAccepted: isDoneAgreement,
      role: "ADMIN",
      isTeamMember: false,
      memberName: s.onboarding?.signatoryName || s.businessName || "Store Owner",
      memberPhone: s.phone,
      memberEmail: s.email || "",
      canViewFinancials: true,
    };

    res.json({ success: true, token, seller: sellerPayload });
    return;
  }

  res.status(400).json({ success: false, error: "Target organization identifier required" });
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

  // Fetch all associated accounts for this user's phone
  const associatedAccounts: Array<{
    accountId: string;
    sellerId: string;
    teamMemberId?: string;
    companyName: string;
    logoUrl: string | null;
    role: string;
    isOwner: boolean;
    canViewFinancials: boolean;
    memberName: string;
    onboardingStatus: string;
    kycVerified: boolean;
  }> = [];

  const { phone: callerPhone } = normalizePhone(memberPhone);

  const ownedSeller = await prisma.seller.findUnique({
    where: { phone: callerPhone },
    include: { onboarding: true },
  });
  if (ownedSeller) {
    associatedAccounts.push({
      accountId: `seller_${ownedSeller.id}`,
      sellerId: ownedSeller.id,
      companyName: ownedSeller.businessName || ownedSeller.onboarding?.businessName || "My Store",
      logoUrl: ownedSeller.onboarding?.logoUrl || null,
      role: "OWNER",
      isOwner: true,
      canViewFinancials: true,
      memberName: ownedSeller.onboarding?.signatoryName || ownedSeller.businessName || "Store Owner",
      onboardingStatus: ownedSeller.onboardingStatus,
      kycVerified: ownedSeller.kycVerified,
    });
  }

  const activeMemberships = await prisma.teamMember.findMany({
    where: { phone: callerPhone, status: "ACTIVE" },
    include: {
      seller: {
        include: { onboarding: true },
      },
    },
  });

  for (const tm of activeMemberships) {
    if (ownedSeller && tm.sellerId === ownedSeller.id) continue;
    associatedAccounts.push({
      accountId: `tm_${tm.id}`,
      sellerId: tm.sellerId,
      teamMemberId: tm.id,
      companyName: tm.seller.businessName || tm.seller.onboarding?.businessName || "Partner Store",
      logoUrl: tm.seller.onboarding?.logoUrl || null,
      role: tm.role,
      isOwner: false,
      canViewFinancials: Boolean(tm.canViewFinancials),
      memberName: tm.name,
      onboardingStatus: tm.seller.onboardingStatus,
      kycVerified: true,
    });
  }

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
    accounts: associatedAccounts,
    hasMultipleAccounts: associatedAccounts.length > 1,
  });
});
