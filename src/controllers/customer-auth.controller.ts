import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { signCustomerToken } from "../utils/jwt";
import { asyncHandler } from "../utils/asyncHandler";
import { generateOtp, isOtpValid } from "../services/auth.service";
import { normalizePhone } from "../utils/phone";
import { otpService } from "../external";

/**
 * Mobile App Auth: Send OTP to customer phone
 */
export const customerSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  if (!phoneRaw) {
    res.status(400).json({ error: "Phone number is required" });
    return;
  }

  const { phone } = normalizePhone(phoneRaw);
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  let customer = await prisma.customer.findUnique({ where: { phone } });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone,
        otpCode: otp,
        otpExpiresAt: expiresAt,
      },
    });
  } else {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        otpCode: otp,
        otpExpiresAt: expiresAt,
      },
    });
  }

  // Send OTP via configured SMS Gateway (MSG91 / Fast2SMS / Twilio)
  await otpService.sendSms(phone, otp);

  const isDev = process.env.NODE_ENV !== "production" && process.env.EXTERNAL_SERVICES_MODE !== "real";
  res.status(200).json({
    message: "OTP sent successfully to mobile app user",
    ...(isDev && { devOtp: otp }),
  });
});

/**
 * Mobile App Auth: Verify OTP & issue Customer JWT
 */
export const customerVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;

  if (!phoneRaw || !otp) {
    res.status(400).json({ error: "Phone and OTP are required" });
    return;
  }

  const { phone } = normalizePhone(phoneRaw);
  const customer = await prisma.customer.findUnique({ where: { phone } });

  if (!customer || !customer.otpCode || !customer.otpExpiresAt) {
    res.status(400).json({ error: "No pending OTP found for this phone number" });
    return;
  }

  if (!isOtpValid(otp, customer.otpCode, customer.otpExpiresAt)) {
    res.status(400).json({ error: "Invalid or expired OTP" });
    return;
  }

  // Clear OTP state and mark phone verified
  const updatedCustomer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      phoneVerified: true,
      otpCode: null,
      otpExpiresAt: null,
    },
  });

  // Generate Mobile App Customer Token with role "customer" and audience "cikka-mobile-app"
  const token = signCustomerToken(updatedCustomer.id);

  res.status(200).json({
    message: "Mobile App login successful",
    token,
    customer: {
      id: updatedCustomer.id,
      phone: updatedCustomer.phone,
      name: updatedCustomer.name,
      email: updatedCustomer.email,
      ciPointsBalance: updatedCustomer.ciPointsBalance,
    },
  });
});

/**
 * Mobile App Auth: Get current customer profile
 */
export const getCustomerMe = asyncHandler(async (req: Request, res: Response) => {
  const customerId = req.customer?.id;

  if (!customerId) {
    res.status(401).json({ error: "Unauthorized customer request" });
    return;
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      phone: true,
      name: true,
      email: true,
      phoneVerified: true,
      ciPointsBalance: true,
      createdAt: true,
    },
  });

  if (!customer) {
    res.status(404).json({ error: "Customer profile not found" });
    return;
  }

  res.status(200).json({ customer });
});
