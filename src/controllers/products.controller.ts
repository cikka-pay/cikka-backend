import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const listProducts = asyncHandler(async (req, res) => {
  const products = await prisma.product.findMany({
    where: { sellerId: req.seller.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(products);
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { id: req.params.id, sellerId: req.seller.id },
  });
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(product);
});

export const createProduct = asyncHandler(async (req, res) => {
  const { name, sku, category, price, stockQty, lowStockThreshold, imageUrl } = req.body as {
    name?: string;
    sku?: string;
    category?: string;
    price?: number;
    stockQty?: number;
    lowStockThreshold?: number;
    imageUrl?: string;
  };

  if (!name || !sku || price === undefined) {
    res.status(400).json({ error: "name, sku, and price are required" });
    return;
  }

  const product = await prisma.product.create({
    data: {
      sellerId: req.seller.id,
      name,
      sku,
      category,
      price,
      stockQty: stockQty ?? 0,
      lowStockThreshold: lowStockThreshold ?? 5,
      imageUrl,
    },
  });

  res.status(201).json(product);
});
