import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { otpService } from "../external";
import { generateOtp, isOtpValid } from "../services/auth.service";
import { normalizePhone } from "../utils/phone";
import { signToken } from "../utils/jwt";

export const inviteTeamMember = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { name, phone: phoneRaw, email, role } = req.body;
  
  if (!name || !phoneRaw || !role) {
    res.status(400).json({ success: false, error: "Name, phone, and role are required." });
    return;
  }

  const { phone } = normalizePhone(phoneRaw);
  
  const existing = await prisma.teamMember.findUnique({
    where: {
      sellerId_phone: { sellerId, phone }
    }
  });

  const otp = generateOtp(6);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  if (existing) {
    if (existing.status === 'ACTIVE') {
      res.status(400).json({ success: false, error: "Team member is already active." });
      return;
    }
    
    await prisma.teamMember.update({
      where: { id: existing.id },
      data: {
        role,
        name,
        email,
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      }
    });
  } else {
    await prisma.teamMember.create({
      data: {
        sellerId,
        name,
        phone,
        email,
        role,
        status: "INVITED",
        phoneOtpCode: otp,
        phoneOtpExpiresAt: expiresAt,
      }
    });
  }

  // Send OTP
  await otpService.sendSms(phone, otp);

  res.json({ success: true, message: "Invite OTP sent successfully." });
});

export const verifyInviteOtp = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { phone: phoneRaw, otp } = req.body;
  
  const { phone } = normalizePhone(phoneRaw);

  const teamMember = await prisma.teamMember.findUnique({
    where: {
      sellerId_phone: { sellerId, phone }
    }
  });

  if (!teamMember) {
    res.status(404).json({ success: false, error: "Team member invite not found." });
    return;
  }

  if (!isOtpValid(teamMember.phoneOtpCode, otp, teamMember.phoneOtpExpiresAt)) {
    res.status(400).json({ success: false, error: "Invalid or expired OTP." });
    return;
  }

  await prisma.teamMember.update({
    where: { id: teamMember.id },
    data: {
      status: "ACTIVE",
      phoneOtpCode: null,
      phoneOtpExpiresAt: null,
    }
  });

  res.json({ success: true, message: "Team member verified and activated." });
});

export const getTeamMembers = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  
  const members = await prisma.teamMember.findMany({
    where: { sellerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      status: true,
      createdAt: true
    }
  });
  
  res.json({ success: true, members });
});

export const updateTeamMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { id } = req.params;
  const { role } = req.body;

  if (!role || !["ADMIN", "EXECUTIVE", "VIEWER"].includes(role.toUpperCase())) {
    res.status(400).json({ success: false, error: "Valid role (ADMIN, EXECUTIVE, VIEWER) is required." });
    return;
  }

  const teamMember = await prisma.teamMember.findFirst({
    where: { id, sellerId }
  });

  if (!teamMember) {
    res.status(404).json({ success: false, error: "Team member not found." });
    return;
  }

  const updated = await prisma.teamMember.update({
    where: { id },
    data: { role: role.toUpperCase() },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      status: true,
      createdAt: true
    }
  });

  res.json({ success: true, message: `Updated role to ${role.toUpperCase()}`, member: updated });
});

export const deleteTeamMember = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { id } = req.params;

  const teamMember = await prisma.teamMember.findFirst({
    where: { id, sellerId }
  });

  if (!teamMember) {
    res.status(404).json({ success: false, error: "Team member not found." });
    return;
  }

  await prisma.teamMember.delete({
    where: { id }
  });

  res.json({ success: true, message: "Team member removed successfully." });
});
