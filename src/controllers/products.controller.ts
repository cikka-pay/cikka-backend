import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma } from "@prisma/client";

async function getValidSellerId(req: Request): Promise<string> {
  const reqSellerId = req.seller?.id;
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
  const sellerId = await getValidSellerId(req);
  const { page = "1", limit = "10", status, category, q } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.ProductWhereInput = { sellerId };

  if (status) where.status = status;
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: { variants: true },
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
    include: { variants: true },
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

  // variants are optional
  const { variants, ...productData } = data;

  const product = await prisma.product.create({
    data: {
      sellerId,
      ...productData,
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

  const { variants, ...updateData } = data;

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

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      ...(stockQty !== undefined && { stockQty }),
      ...(price !== undefined && { price }),
    },
  });

  res.json(updated);
});
