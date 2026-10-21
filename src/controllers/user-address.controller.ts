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
  const phone = (req.query.phone as string) || (req.query.userPhone as string) || "9876549812";
  const userId = (req.query.userId as string) || (req as any).user?.id;

  const whereClause: any = userId ? { OR: [{ userId }, { phone }] } : { phone };

  let rawAddresses = await prisma.userAddress.findMany({
    where: whereClause,
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  // If no address exists, seed an initial authentic address for smooth checkout
  if (rawAddresses.length === 0) {
    const defaultAddr = await prisma.userAddress.create({
      data: {
        name: "Sujal Sharma",
        phone,
        houseNo: "Flat 402, Prestige Towers",
        street: "BKC, Bandra East",
        landmark: "Asian Heart Institute",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400051",
        isDefault: true,
      },
    });
    rawAddresses = [defaultAddr];
  }

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

  const primary = formattedAddresses.find((a) => a.isDefault) || formattedAddresses[0];

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
  const {
    id,
    name,
    phone = "9876549812",
    houseNo,
    street,
    landmark,
    city = "Mumbai",
    state = "Maharashtra",
    pincode = "400051",
    isDefault = true,
  } = req.body;

  if (!name || !pincode) {
    res.status(400).json({
      success: false,
      error: "name and pincode are required",
    });
    return;
  }

  // If setting this address as default, unset previous defaults
  if (isDefault) {
    await prisma.userAddress.updateMany({
      where: { phone },
      data: { isDefault: false },
    });
  }

  let record: any;
  if (id && !id.startsWith("addr_local_")) {
    record = await prisma.userAddress.update({
      where: { id },
      data: {
        name,
        phone,
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
        name,
        phone,
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

  await prisma.userAddress.delete({
    where: { id },
  });

  res.status(200).json({
    success: true,
    message: "Address deleted successfully",
  });
});
