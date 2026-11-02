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
  z.enum(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "OUT_OF_STOCK", "REJECTED"])
).optional();

const productQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: statusEnum,
  category: z.string().optional(),
  q: z.string().optional(),
  sellerId: z.string().optional(),
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
  gstSlab: z.number().int().optional().default(18),
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

import { requireRole, requireSellerAuth, requirePanVerifiedUserOrSellerAuth } from "../middleware/auth.middleware";

// Protected Mall Catalog Endpoints: ONLY Sellers, Admins, or PAN-Verified Mobile Users can access
router.get("/", requirePanVerifiedUserOrSellerAuth, validate({ query: productQuerySchema }), listProducts);
router.get("/:id", requirePanVerifiedUserOrSellerAuth, getProduct);

// Creation and modification allowed for ADMIN and EXECUTIVE on seller endpoints
router.post("/", requireSellerAuth, requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: createProductSchema }), createProduct);
router.patch("/:id", requireSellerAuth, requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: updateProductSchema }), updateProduct);
router.patch("/:id/variants/:variantId", requireSellerAuth, requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: updateVariantSchema }), updateVariant);
router.delete("/:id", requireSellerAuth, requireRole(["ADMIN", "EXECUTIVE"]), deleteProduct);

export default router;
