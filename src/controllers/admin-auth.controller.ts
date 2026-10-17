import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { signAdminToken } from "../utils/jwt";
import { config } from "../config/env";

export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase() },
  });

  const passwordOk = admin ? await bcrypt.compare(password, admin.passwordHash).catch(() => false) : false;
  if (!admin || !admin.isActive || !passwordOk) {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }

  const token = signAdminToken({ id: admin.id, email: admin.email, role: admin.role });

  res.json({
    token,
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  });
});

export const getAdminProfile = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.admin?.id;
  if (!adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  if (!admin) {
    res.status(404).json({ error: "Admin account not found" });
    return;
  }

  res.json({ admin });
});

export const verifyAccessCode = asyncHandler(async (req: Request, res: Response) => {
  const { accessCode, panelType } = req.body;

  if (!accessCode) {
    res.status(400).json({ error: "Access Code is required" });
    return;
  }

  const isSellerAdmin = panelType === "SELLER_ADMIN";

  // In production the code must come from env — no hardcoded defaults or convenience aliases.
  const envCode = isSellerAdmin ? process.env.SELLER_ADMIN_ACCESS_CODE : process.env.SUPER_ADMIN_ACCESS_CODE;
  const devDefault = isSellerAdmin ? "CIKKA_SELLER_ADMIN_2026_SECRET" : "CIKKA_SUPER_2026_SECURE";
  const expectedCode = (envCode || (config.isProduction ? "" : devDefault)).trim();

  const given = Buffer.from(String(accessCode).trim());
  const expected = Buffer.from(expectedCode);
  const codeOk = expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!codeOk) {
    res.status(401).json({ error: "Invalid Secret Access Code" });
    return;
  }

  const role = isSellerAdmin ? "ONBOARDING_VERIFIER" : "SUPER_ADMIN";
  const email = isSellerAdmin ? "seller.admin@cikka.in" : "admin@cikka.in";

  const token = signAdminToken({ id: isSellerAdmin ? "sel_admin_root" : "super_admin_root", email, role });

  res.json({
    valid: true,
    message: "Access Granted",
    token,
    user: {
      id: isSellerAdmin ? "sel_admin_root" : "super_admin_root",
      email,
      name: isSellerAdmin ? "Cikka Seller Onboarding Admin" : "Cikka Master Control Officer",
      role,
    },
  });
});
