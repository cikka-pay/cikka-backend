import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";

export const getAlerts = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5, 50);

  // Prisma's standard client can't compare two columns to each other in a `where`
  // clause (no field-to-field comparison), so we fetch this seller's products and
  // filter `stockQty <= lowStockThreshold` in JS. Fine at catalog sizes typical of a
  // single seller; if this becomes a bottleneck, switch to
  // `prisma.$queryRaw` with `WHERE stock_qty <= low_stock_threshold` instead.
  const products = await prisma.product.findMany({
    where: { sellerId: req.seller.id, status: "active" },
    orderBy: { stockQty: "asc" },
  });

  const lowStock = products
    .filter((p) => p.stockQty <= p.lowStockThreshold)
    .slice(0, limit);

  res.json(
    lowStock.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      stockQty: p.stockQty,
      lowStockThreshold: p.lowStockThreshold,
      imageUrl: p.imageUrl,
    }))
  );
});
