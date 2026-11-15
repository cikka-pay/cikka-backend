import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Helper to format full address string
 */
function formatFullAddress(addr: any): string {
  if (!addr) return "";
  const parts = [
    addr.houseNo,
    addr.street,
    addr.landmark ? `Near ${addr.landmark}` : "",
    addr.city,
    addr.state,
    addr.pincode ? `– ${addr.pincode}` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * GET /api/user/addresses
 * GET /api/user/address
 * Fetch all saved delivery addresses for the user
 */
export const getUserAddress = asyncHandler(async (req: Request, res: Response) => {
  const authUserId = (req as any).user?.id;
  const authUserPhone = (req as any).user?.phone;
  const queryPhone = (req.query.phone as string) || (req.query.userPhone as string);
  const queryUserId = (req.query.userId as string);

  const targetUserId = authUserId || queryUserId;
  const targetPhone = authUserPhone || queryPhone;

  // Security guard: If neither authenticated user ID nor target phone is available,
  // do NOT query with an empty where clause (which dumps the entire table).
  if (!targetUserId && !targetPhone) {
    res.status(200).json({
      success: true,
      addresses: [],
      address: null,
    });
    return;
  }

  const orConditions: any[] = [];
  if (targetUserId) orConditions.push({ userId: targetUserId });
  if (targetPhone) orConditions.push({ phone: targetPhone });

  const rawAddresses = await prisma.userAddress.findMany({
    where: orConditions.length > 1 ? { OR: orConditions } : orConditions[0],
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  const formattedAddresses = rawAddresses.map((a) => ({
    id: a.id,
    name: a.name,
    phone: a.phone,
    houseNo: a.houseNo || "",
    street: a.street || "",
    landmark: a.landmark || "",
    city: a.city,
    state: a.state || "",
    pincode: a.pincode,
    fullAddr: formatFullAddress(a),
    isDefault: a.isDefault,
  }));

  const primary = formattedAddresses.find((a) => a.isDefault) || formattedAddresses[0] || null;

  res.status(200).json({
    success: true,
    addresses: formattedAddresses,
    address: primary,
  });
});

/**
 * POST /api/user/addresses
 * POST /api/user/address
 * Create or update a saved delivery address
 */
export const saveUserAddress = asyncHandler(async (req: Request, res: Response) => {
  const authUserId = (req as any).user?.id;
  const authUserPhone = (req as any).user?.phone;

  const {
    id,
    name,
    phone = authUserPhone || "",
    houseNo,
    street,
    landmark,
    city = "Mumbai",
    state = "Maharashtra",
    pincode,
    isDefault = true,
  } = req.body;

  const effectivePhone = authUserPhone || phone;
  const effectiveUserId = authUserId || (req.body.userId as string);

  if (!name || !pincode) {
    res.status(400).json({
      success: false,
      error: "name and pincode are required",
    });
    return;
  }

  // If setting this address as default, unset previous defaults
  if (isDefault) {
    const defaultWhere: any = {};
    if (effectiveUserId) defaultWhere.userId = effectiveUserId;
    else if (effectivePhone) defaultWhere.phone = effectivePhone;

    if (Object.keys(defaultWhere).length > 0) {
      await prisma.userAddress.updateMany({
        where: defaultWhere,
        data: { isDefault: false },
      });
    }
  }

  let record: any;
  if (id && !id.startsWith("addr_local_")) {
    const existing = await prisma.userAddress.findUnique({ where: { id } });
    if (existing) {
      // Check ownership
      if (authUserId && existing.userId && existing.userId !== authUserId) {
        res.status(403).json({ success: false, error: "Unauthorized address modification" });
        return;
      }

      record = await prisma.userAddress.update({
        where: { id },
        data: {
          name,
          phone: effectivePhone,
          userId: existing.userId || effectiveUserId,
          houseNo: houseNo || "",
          street: street || "",
          landmark: landmark || "",
          city,
          state,
          pincode,
          isDefault: Boolean(isDefault),
        },
      });
    } else {
      record = await prisma.userAddress.create({
        data: {
          id,
          userId: effectiveUserId,
          name,
          phone: effectivePhone,
          houseNo: houseNo || "",
          street: street || "",
          landmark: landmark || "",
          city,
          state,
          pincode,
          isDefault: Boolean(isDefault),
        },
      });
    }
  } else {
    record = await prisma.userAddress.create({
      data: {
        userId: effectiveUserId,
        name,
        phone: effectivePhone,
        houseNo: houseNo || "",
        street: street || "",
        landmark: landmark || "",
        city,
        state,
        pincode,
        isDefault: Boolean(isDefault),
      },
    });
  }

  const fullAddr = formatFullAddress(record);

  res.status(201).json({
    success: true,
    message: "Delivery address saved successfully",
    address: {
      id: record.id,
      name: record.name,
      phone: record.phone,
      houseNo: record.houseNo,
      street: record.street,
      landmark: record.landmark,
      city: record.city,
      state: record.state,
      pincode: record.pincode,
      fullAddr,
      isDefault: record.isDefault,
    },
  });
});

/**
 * DELETE /api/user/addresses/:id
 * Delete a delivery address
 */
export const deleteUserAddress = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const authUserId = (req as any).user?.id;
  const authUserPhone = (req as any).user?.phone;

  const existing = await prisma.userAddress.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ success: false, error: "Address not found" });
    return;
  }

  if (authUserId && existing.userId && existing.userId !== authUserId) {
    res.status(403).json({ success: false, error: "Unauthorized address deletion" });
    return;
  }
  if (authUserPhone && existing.phone && existing.phone !== authUserPhone && (!existing.userId || existing.userId !== authUserId)) {
    res.status(403).json({ success: false, error: "Unauthorized address deletion" });
    return;
  }

  await prisma.userAddress.delete({
    where: { id },
  });

  res.status(200).json({
    success: true,
    message: "Address deleted successfully",
  });
});
