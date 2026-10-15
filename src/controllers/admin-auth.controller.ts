import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { config } from "../config/env";
import { signAdminToken } from "../utils/jwt";

// Constant-time string comparison (hash first so differing lengths don't leak via timing).
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const adminLogin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  // Admin accounts are provisioned with `npm run create-admin`.
  const admin = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  const passwordOk = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
  if (!admin || !passwordOk || !admin.isActive) {
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
  const tokenAdmin = req.admin;
  if (!tokenAdmin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const admin = await prisma.adminUser.findUnique({
    where: { id: tokenAdmin.id },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  // Access-code sessions have no admin_users row — answer from the token claims.
  res.json({ admin: admin ?? { ...tokenAdmin, isActive: true } });
});

export const verifyAccessCode = asyncHandler(async (req: Request, res: Response) => {
  const { accessCode, panelType } = req.body || {};

  if (typeof accessCode !== "string" || !accessCode.trim()) {
    res.status(400).json({ error: "Access Code is required" });
    return;
  }

  const isSellerAdmin = panelType === "SELLER_ADMIN";
  const expectedCode = isSellerAdmin ? config.sellerAdminAccessCode : config.superAdminAccessCode;

  if (!expectedCode) {
    res.status(503).json({ error: "Admin access code is not configured on the server" });
    return;
  }

  if (!safeEqual(accessCode.trim(), expectedCode.trim())) {
    res.status(401).json({ error: "Invalid Secret Access Code" });
    return;
  }

  const user = isSellerAdmin
    ? {
        id: "sel_admin_root",
        email: "seller.admin@cikka.in",
        name: "Cikka Seller Onboarding Admin",
        role: "ONBOARDING_VERIFIER",
      }
    : {
        id: "super_admin_root",
        email: "admin@cikka.in",
        name: "Cikka Master Control Officer",
        role: "SUPER_ADMIN",
      };

  const token = signAdminToken(user);

  res.json({
    valid: true,
    message: "Access Granted",
    token,
    user,
  });
});
