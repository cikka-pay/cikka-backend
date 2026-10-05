import { Router } from "express";
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  updateVariant,
} from "../controllers/products.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const statusEnum = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  z.enum(["DRAFT", "ACTIVE", "INACTIVE", "OUT_OF_STOCK"])
).optional();

const productQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: statusEnum,
  category: z.string().optional(),
  q: z.string().optional(),
});

const variantSchema = z.object({
  typeName: z.string(),
  value: z.string(),
  stockQty: z.number().int().min(0).optional(),
  price: z.number().positive().optional(),
});

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sku: z.string().min(1, "SKU is required"),
  category: z.string().optional(),
  description: z.string().optional(),
  mrp: z.number().positive().optional(),
  price: z.number().positive("Price is required"),
  gstSlab: z.number().int().optional(),
  loyaltyPoints: z.number().int().min(0).optional(),
  stockQty: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  weightGrams: z.number().positive().optional(),
  dimLengthCm: z.number().positive().optional(),
  dimWidthCm: z.number().positive().optional(),
  dimHeightCm: z.number().positive().optional(),
  fulfillmentType: z.enum(["SELF", "THREE_PL", "CIKKA"]).optional(),
  dispatchDays: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  videoUrl: z.string().optional(),
  status: statusEnum,
  variants: z.array(variantSchema).optional(),
});

const updateProductSchema = createProductSchema.partial();

const updateVariantSchema = z.object({
  stockQty: z.number().int().min(0).optional(),
  price: z.number().positive().optional(),
});

import { requireRole } from "../middleware/auth.middleware";

router.get("/", validate({ query: productQuerySchema }), listProducts);
router.get("/:id", getProduct);

// Creation and modification allowed for ADMIN and EXECUTIVE, Viewer is read-only
router.post("/", requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: createProductSchema }), createProduct);
router.patch("/:id", requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: updateProductSchema }), updateProduct);
router.patch("/:id/variants/:variantId", requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: updateVariantSchema }), updateVariant);
router.delete("/:id", requireRole(["ADMIN", "EXECUTIVE"]), deleteProduct);

export default router;
