import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * GET /api/user/address
 * Fetch saved delivery address for the user (by phone, userId, or default)
 */
export const getUserAddress = asyncHandler(async (req: Request, res: Response) => {
  const phone = (req.query.phone as string) || (req.query.userPhone as string);
  const userId = (req.query.userId as string) || (req as any).user?.id;

  const userAddressModel = (prisma as any).userAddress || (prisma as any).UserAddress;

  let address = null;

  if (userAddressModel) {
    if (userId) {
      address = await userAddressModel.findFirst({
        where: { userId, isDefault: true },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!address && phone) {
      address = await userAddressModel.findFirst({
        where: { phone, isDefault: true },
        orderBy: { updatedAt: "desc" },
      });
    }

    // Fallback to most recent saved address
    if (!address) {
      address = await userAddressModel.findFirst({
        orderBy: { updatedAt: "desc" },
      });
    }
  }

  if (!address) {
    res.status(200).json({
      success: true,
      address: null,
      message: "No saved delivery address found",
    });
    return;
  }

  const fullAddr = [
    address.houseNo,
    address.street,
    address.landmark ? `Near ${address.landmark}` : "",
    address.city,
    address.state,
    address.pincode,
  ].filter(Boolean).join(", ");

  res.status(200).json({
    success: true,
    address: {
      id: address.id,
      name: address.name,
      phone: address.phone,
      houseNo: address.houseNo || "",
      street: address.street || "",
      landmark: address.landmark || "",
      city: address.city,
      state: address.state || "",
      pincode: address.pincode,
      fullAddr,
      isDefault: address.isDefault,
    },
  });
});

/**
 * POST /api/user/address
 * Create or update a saved delivery address for the user
 */
export const saveUserAddress = asyncHandler(async (req: Request, res: Response) => {
  const { name, phone, houseNo, street, landmark, city, state, pincode, isDefault = true } = req.body;

  if (!name || !phone || !pincode) {
    res.status(400).json({
      success: false,
      error: "name, phone, and pincode are required",
    });
    return;
  }

  const userAddressModel = (prisma as any).userAddress || (prisma as any).UserAddress;

  // Find existing user by phone if available
  const existingUser = await prisma.user.findUnique({
    where: { phone },
  });

  if (userAddressModel && isDefault) {
    await userAddressModel.updateMany({
      where: {
        OR: [
          { phone },
          ...(existingUser ? [{ userId: existingUser.id }] : []),
        ],
      },
      data: { isDefault: false },
    });
  }

  let address: any = {
    id: `addr_${Date.now()}`,
    name,
    phone,
    houseNo: houseNo || "",
    street: street || "",
    landmark: landmark || "",
    city: city || "Mumbai",
    state: state || "Maharashtra",
    pincode,
    isDefault: Boolean(isDefault),
  };

  if (userAddressModel) {
    address = await userAddressModel.create({
      data: {
        userId: existingUser?.id || null,
        name,
        phone,
        houseNo: houseNo || "",
        street: street || "",
        landmark: landmark || "",
        city: city || "Mumbai",
        state: state || "Maharashtra",
        pincode,
        isDefault: Boolean(isDefault),
      },
    });
  }

  const fullAddr = [
    address.houseNo,
    address.street,
    address.landmark ? `Near ${address.landmark}` : "",
    address.city,
    address.state,
    address.pincode,
  ].filter(Boolean).join(", ");

  res.status(201).json({
    success: true,
    message: "Delivery address saved successfully",
    address: {
      id: address.id,
      name: address.name,
      phone: address.phone,
      houseNo: address.houseNo,
      street: address.street,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      fullAddr,
      isDefault: address.isDefault,
    },
  });
});

