// Moves base64 `data:image/...` values out of Postgres into the configured
// storage provider (Railway Bucket) and replaces them with /api/files/<key> URLs.
//
// Covers Product.imageUrls (JSON string[]) and SellerOnboarding.logoUrl.
// Idempotent: values that are not data URLs are left untouched.
//
// Usage:
//   npm run migrate:images -- --dry-run
//   npm run migrate:images
// Needs DATABASE_URL, the S3_* storage vars and PUBLIC_BASE_URL (so stored URLs are absolute).
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "../src/config/env";
import { storageService } from "../src/external";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const dryRun = process.argv.includes("--dry-run");

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s;
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const stats = { productsScanned: 0, productsUpdated: 0, logosUpdated: 0, imagesMoved: 0, bytes: 0, failures: 0 };

/** Upload a data URL and return its public URL; returns the input unchanged if it is not a data URL. */
async function moveIfDataUrl(value: unknown, folder: string, entityId: string, name: string): Promise<unknown> {
  if (typeof value !== "string") return value;
  const match = DATA_URL_RE.exec(value);
  if (!match) return value;

  const [, mimeType, b64] = match;
  const buffer = Buffer.from(b64, "base64");
  stats.imagesMoved++;
  stats.bytes += buffer.length;

  if (dryRun) return `(dry-run) ${folder}/${entityId}/${name} ${buffer.length}B`;

  const result = await storageService.uploadFile({
    buffer,
    filename: `${name}.${EXT_BY_MIME[mimeType] ?? "bin"}`,
    mimeType,
    folder,
    entityId,
    metadata: { migratedFrom: "base64" },
  });
  return result.url;
}

async function migrateProducts() {
  const pageSize = 50;
  let cursor: string | undefined;

  for (;;) {
    const products = await prisma.product.findMany({
      select: { id: true, sellerId: true, imageUrls: true },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (products.length === 0) break;
    cursor = products[products.length - 1].id;

    for (const product of products) {
      stats.productsScanned++;
      if (!Array.isArray(product.imageUrls)) continue;
      const original = product.imageUrls as unknown[];
      if (!original.some((v) => typeof v === "string" && v.startsWith("data:"))) continue;

      try {
        const next: unknown[] = [];
        for (let i = 0; i < original.length; i++) {
          next.push(await moveIfDataUrl(original[i], "products", `seller-${product.sellerId}`, `${product.id}-${i}`));
        }
        if (!dryRun) {
          await prisma.product.update({ where: { id: product.id }, data: { imageUrls: next as string[] } });
        }
        stats.productsUpdated++;
        console.log(`[product ${product.id}] ${dryRun ? "would move" : "moved"} images`);
      } catch (err) {
        stats.failures++;
        console.error(`[product ${product.id}] failed:`, err);
      }
    }
  }
}

async function migrateLogos() {
  const rows = await prisma.sellerOnboarding.findMany({
    where: { logoUrl: { startsWith: "data:" } },
    select: { sellerId: true, logoUrl: true },
  });

  for (const row of rows) {
    try {
      const url = await moveIfDataUrl(row.logoUrl, "logos", row.sellerId, "logo");
      if (!dryRun) {
        await prisma.sellerOnboarding.update({ where: { sellerId: row.sellerId }, data: { logoUrl: url as string } });
      }
      stats.logosUpdated++;
      console.log(`[logo ${row.sellerId}] ${dryRun ? "would move" : "moved"}`);
    } catch (err) {
      stats.failures++;
      console.error(`[logo ${row.sellerId}] failed:`, err);
    }
  }
}

async function main() {
  console.log(`Storage provider: ${config.storageProvider}${dryRun ? " (dry run — nothing is written)" : ""}`);
  if (!dryRun && !config.publicBaseUrl) {
    console.error("PUBLIC_BASE_URL is not set — refusing to store relative /api/files URLs.");
    process.exit(1);
  }
  if (!dryRun && config.storageProvider === "local") {
    console.error("STORAGE_PROVIDER is local — set the S3_* vars so images go to the bucket.");
    process.exit(1);
  }

  await migrateProducts();
  await migrateLogos();

  console.log(
    `Done. products scanned=${stats.productsScanned} updated=${stats.productsUpdated}, ` +
      `logos updated=${stats.logosUpdated}, images=${stats.imagesMoved} ` +
      `(${(stats.bytes / 1024 / 1024).toFixed(2)} MB), failures=${stats.failures}`
  );
  if (stats.failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
