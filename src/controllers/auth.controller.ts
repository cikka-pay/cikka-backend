import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma";
import { signToken } from "../utils/jwt";
import { asyncHandler } from "../utils/asyncHandler";

export const login = asyncHandler(async (req, res) => {
  const { loginId, password } = req.body as { loginId?: string; password?: string };

  if (!loginId || !password) {
    res.status(400).json({ error: "loginId and password are required" });
    return;
  }

  const seller = await prisma.seller.findUnique({ where: { loginId } });
  if (!seller) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, seller.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = signToken(seller.id);

  res.json({
    token,
    seller: {
      id: seller.id,
      businessName: seller.businessName,
      kycVerified: seller.kycVerified,
    },
  });
});
