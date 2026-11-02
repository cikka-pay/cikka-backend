import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

async function getValidSellerId(req: Request): Promise<string> {
  const rawSellerId = req.seller?.id;
  const reqSellerId = typeof rawSellerId === "object" && rawSellerId !== null 
    ? ((rawSellerId as any).id || String(rawSellerId)) 
    : (typeof rawSellerId === "string" ? rawSellerId : undefined);

  if (reqSellerId) {
    const existingSeller = await prisma.seller.findUnique({ where: { id: reqSellerId } });
    if (existingSeller) return existingSeller.id;
  }

  const firstSeller = await prisma.seller.findFirst();
  if (firstSeller) return firstSeller.id;

  const newSeller = await prisma.seller.create({
    data: {
      phone: "+919876543210",
      businessName: "Aura Vogue Store",
      phoneVerified: true,
      onboardingStatus: "VERIFIED",
    },
  });
  return newSeller.id;
}

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const { page = "1", limit = "500", status, category, q, sellerId } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10) || 500;
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.ProductWhereInput = {};

  // Case 1: Admin Panel
  if (req.admin?.id) {
    if (status) where.status = status;
    if (sellerId) where.sellerId = sellerId;
  }
  // Case 2: Authenticated Seller (via Seller Dashboard cikka-fe)
  else if (req.seller?.id) {
    where.sellerId = req.seller.id;
    if (status) where.status = status;
  } 
  // Case 3: Public Customer / Mobile App Mall (No Seller JWT attached)
  else {
    // Condition: ONLY approved active products displayed in Cikka Mall
    where.status = "ACTIVE";
    if (sellerId) where.sellerId = sellerId;
  }

  if (category && category.toLowerCase() !== "all") {
    where.category = { equals: category, mode: "insensitive" };
  }

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { brandName: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: {
        variants: true,
        seller: {
          select: {
            id: true,
            businessName: true,
            onboardingStatus: true,
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({
    data,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await prisma.product.findFirst({
    where: { id: req.params.id },
    include: {
      variants: true,
      seller: {
        select: {
          id: true,
          businessName: true,
          onboardingStatus: true,
        },
      },
    },
  });
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(product);
});

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = await getValidSellerId(req);
  const data = req.body;

  // variants and legacy single imageUrl are handled safely
  const { variants, imageUrl, ...productData } = data;

  let finalImageUrls = productData.imageUrls;
  if (!finalImageUrls && imageUrl) {
    finalImageUrls = [imageUrl];
  } else if (Array.isArray(finalImageUrls) && imageUrl && !finalImageUrls.includes(imageUrl)) {
    finalImageUrls = [imageUrl, ...finalImageUrls];
  }

  if (productData.mrp !== undefined && productData.price !== undefined && productData.price > productData.mrp) {
    res.status(400).json({ error: "Selling price cannot exceed MRP" });
    return;
  }

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    include: { onboarding: true },
  });
  const onboardedBrand = seller?.businessName || seller?.onboarding?.businessName;
  const finalBrandName = onboardedBrand || productData.brandName || undefined;

  const product = await prisma.product.create({
    data: {
      sellerId,
      ...productData,
      imageUrls: finalImageUrls,
      brandName: finalBrandName,
      status: 'PENDING_APPROVAL',
      variants: variants && variants.length > 0 ? {
        create: variants.map((v: any) => ({
          typeName: v.typeName,
          value: v.value,
          stockQty: v.stockQty ?? 0,
          price: v.price,
        })),
      } : undefined,
    },
    include: { variants: true },
  });

  res.status(201).json(product);
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const existing = await prisma.product.findFirst({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const { variants, imageUrl, ...updateData } = data;

  if (imageUrl) {
    if (!updateData.imageUrls) {
      updateData.imageUrls = [imageUrl];
    } else if (Array.isArray(updateData.imageUrls) && !updateData.imageUrls.includes(imageUrl)) {
      updateData.imageUrls = [imageUrl, ...updateData.imageUrls];
    }
  }

  const effectiveMrp = updateData.mrp !== undefined ? updateData.mrp : (existing.mrp !== null ? Number(existing.mrp) : undefined);
  const effectivePrice = updateData.price !== undefined ? updateData.price : Number(existing.price);
  if (effectiveMrp !== undefined && effectivePrice > effectiveMrp) {
    res.status(400).json({ error: "Selling price cannot exceed MRP" });
    return;
  }

  // Ensure brand name cannot be altered away from seller onboarded brand
  const seller = await prisma.seller.findUnique({
    where: { id: existing.sellerId },
    include: { onboarding: true },
  });
  const onboardedBrand = seller?.businessName || seller?.onboarding?.businessName;
  if (onboardedBrand) {
    updateData.brandName = onboardedBrand;
  }

  // Detect pricing or MRP update by seller
  const requestedNewPrice = updateData.price !== undefined ? Number(updateData.price) : undefined;
  const requestedNewMrp = updateData.mrp !== undefined ? Number(updateData.mrp) : undefined;
  const priceChanged = requestedNewPrice !== undefined && Math.abs(requestedNewPrice - Number(existing.price)) > 0.001;
  const mrpChanged = requestedNewMrp !== undefined && (existing.mrp === null || Math.abs(requestedNewMrp - Number(existing.mrp)) > 0.001);

  if (!req.admin?.id) {
    if (existing.pendingPrice !== null && (priceChanged || mrpChanged)) {
      res.status(400).json({ error: "A price update request is already pending approval by Admin" });
      return;
    }

    if (existing.status === "ACTIVE" || existing.status === "INACTIVE" || existing.status === "OUT_OF_STOCK") {
      if (priceChanged || mrpChanged) {
        // Record requested new price for Admin Seller Dashboard approval
        updateData.pendingPrice = requestedNewPrice !== undefined ? requestedNewPrice : Number(existing.price);
        if (requestedNewMrp !== undefined) {
          updateData.pendingMrp = requestedNewMrp;
        }
        updateData.priceRequestedAt = new Date();

        // Keep product running with its current/last price and status
        updateData.price = existing.price;
        if (existing.mrp !== null) {
          updateData.mrp = existing.mrp;
        } else {
          delete updateData.mrp;
        }
        updateData.status = existing.status;
      }
    } else if (existing.status === "PENDING_APPROVAL" && updateData.status === "ACTIVE") {
      // Do not allow sellers to self-approve a pending product directly
      delete updateData.status;
    }
  }

  if (variants && Array.isArray(variants)) {
    await prisma.productVariant.deleteMany({ where: { productId: id } });
    if (variants.length > 0) {
      await prisma.productVariant.createMany({
        data: variants.map((v: any) => ({
          productId: id,
          typeName: v.typeName,
          value: v.value,
          stockQty: v.stockQty ?? 0,
          price: v.price ?? existing.price,
        })),
      });
    }
  }

  const product = await prisma.product.update({
    where: { id },
    data: updateData,
    include: { variants: true },
  });

  // Notify seller of pending price approval if pricing was requested
  if ((priceChanged || mrpChanged) && !req.admin?.id && existing.status !== "PENDING_APPROVAL") {
    await prisma.notification.create({
      data: {
        sellerId: existing.sellerId,
        type: "PRODUCT" as any,
        title: `Price Change Requested: ${existing.name}`,
        body: `Your request to update price from ₹${Number(existing.price).toFixed(2)} to ₹${Number(updateData.pendingPrice).toFixed(2)} was sent to Admin. Your product remains Active at ₹${Number(existing.price).toFixed(2)} until approved.`,
        metadata: {
          productId: existing.id,
          sku: existing.sku,
          currentPrice: Number(existing.price),
          pendingPrice: Number(updateData.pendingPrice),
          pendingMrp: updateData.pendingMrp ? Number(updateData.pendingMrp) : undefined,
          status: "PRICE_PENDING_APPROVAL",
        },
      },
    }).catch(() => {});
  }

  res.json(product);
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const existing = await prisma.product.findFirst({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  await prisma.productVariant.deleteMany({ where: { productId: id } });
  await prisma.orderItem.deleteMany({ where: { productId: id } });
  await prisma.product.delete({ where: { id } });

  res.json({ message: "Product deleted successfully" });
});

export const updateVariant = asyncHandler(async (req: Request, res: Response) => {
  const { id, variantId } = req.params;
  const sellerId = await getValidSellerId(req);
  const { stockQty, price } = req.body;

  // Ensure the product belongs to this seller
  const product = await prisma.product.findFirst({ where: { id, sellerId } });
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId: id },
  });
  if (!variant) {
    res.status(404).json({ error: "Variant not found" });
    return;
  }

  const priceChanged = price !== undefined && Math.abs(Number(price) - Number(variant.price ?? product.price)) > 0.001;

  if (priceChanged && !req.admin?.id) {
    await prisma.product.update({
      where: { id },
      data: { status: "PENDING_APPROVAL" },
    });
  }

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(stockQty !== undefined && { stockQty }),
      ...(price !== undefined && { price }),
    },
  });

  res.json(updated);
});

/**
 * GET /api/mall/products
 * Public Cikka Mall Catalog for Product Exploration & Single-Loop Exchanges
 */
export const listMallCatalogProducts = asyncHandler(async (req: Request, res: Response) => {
  const { page = "1", limit = "60", category, q } = req.query as any;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 60;
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.ProductWhereInput = {
    status: { in: ["ACTIVE", "DRAFT"] }, // Available in mall
  };

  if (category && category !== "ALL") {
    where.category = { contains: category, mode: "insensitive" };
  }

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: {
        variants: true,
        seller: {
          select: {
            id: true,
            businessName: true,
            email: true,
            onboarding: {
              select: {
                businessName: true,
                pickupAddress: true,
              },
            },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({
    data,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

