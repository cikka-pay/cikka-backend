import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { AUTH_ERRORS } from "../constants/errors";
import {
  sendUserOtpService,
  verifyUserOtpService,
  getUserProfileService,
} from "../services/user-auth.service";

/**
 * Mobile App Auth: Send OTP to user phone
 */
export const userSendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw } = req.body;
  const { otp, isDev } = await sendUserOtpService(phoneRaw);

  res.status(200).json({
    message: "OTP sent successfully to mobile app user",
    ...(isDev && { devOtp: otp }),
  });
});

/**
 * Mobile App Auth: Verify OTP & issue User JWT
 */
export const userVerifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: phoneRaw, otp } = req.body;

  try {
    const result = await verifyUserOtpService(phoneRaw, otp);
    res.status(200).json({
      message: "Mobile App login successful",
      token: result.token,
      user: result.user,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || AUTH_ERRORS.INVALID_OTP });
  }
});


/**
 * Mobile App Auth: Get current user profile
 */
export const getUserMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({ error: AUTH_ERRORS.UNAUTHORIZED });
    return;
  }

  try {
    const user = await getUserProfileService(userId);
    res.status(200).json({ user });
  } catch (err: any) {
    res.status(404).json({ error: err.message || AUTH_ERRORS.USER_NOT_FOUND });
  }
});

// Backward compatibility exports
export const customerSendOtp = userSendOtp;
export const customerVerifyOtp = userVerifyOtp;
export const getCustomerMe = getUserMe;
