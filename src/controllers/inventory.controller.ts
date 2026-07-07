import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const getAlerts = asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 5, 50);

  // Fetch all active products
  const products = await prisma.product.findMany({
    where: { sellerId: req.seller!.id, status: "ACTIVE" },
    include: { variants: true },
  });

  // Collect items that are low in stock (both root products and variants)
  const lowStock: any[] = [];

  for (const p of products) {
    if (p.variants.length > 0) {
      for (const v of p.variants) {
        if (v.stockQty <= (p.lowStockThreshold || 5)) {
          lowStock.push({
            id: p.id,
            variantId: v.id,
            name: `${p.name} - ${v.value}`,
            sku: p.sku,
            stockQty: v.stockQty,
            lowStockThreshold: p.lowStockThreshold,
            imageUrl: (p.imageUrls as string[])?.[0] || null,
          });
        }
      }
    } else {
      if (p.stockQty <= (p.lowStockThreshold || 5)) {
        lowStock.push({
          id: p.id,
          name: p.name,
          sku: p.sku,
          stockQty: p.stockQty,
          lowStockThreshold: p.lowStockThreshold,
          imageUrl: (p.imageUrls as string[])?.[0] || null,
        });
      }
    }
  }

  // Sort by stock quantity ascending and limit
  lowStock.sort((a, b) => a.stockQty - b.stockQty);
  res.json(lowStock.slice(0, limit));
});

export const restock = asyncHandler(async (req: Request, res: Response) => {
  const { productId, variantId, quantity } = req.body;
  const sellerId = req.seller!.id;

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId },
  });

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!variant) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data: { stockQty: { increment: quantity } },
    });
    res.json({ stockQty: updated.stockQty });
  } else {
    const updated = await prisma.product.update({
      where: { id: productId },
      data: { stockQty: { increment: quantity } },
    });
    res.json({ stockQty: updated.stockQty });
  }
});
