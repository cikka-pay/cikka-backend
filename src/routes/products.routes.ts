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

// Zod schemas
const productQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "OUT_OF_STOCK"]).optional(),
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
  imageUrls: z.array(z.string().url()).optional(),
  videoUrl: z.string().url().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "OUT_OF_STOCK"]).optional(),
  variants: z.array(variantSchema).optional(),
});

const updateProductSchema = createProductSchema.partial();

const updateVariantSchema = z.object({
  stockQty: z.number().int().min(0).optional(),
  price: z.number().positive().optional(),
});

router.get("/", validate({ query: productQuerySchema }), listProducts);
router.get("/:id", getProduct);
router.post("/", validate({ body: createProductSchema }), createProduct);
router.patch("/:id", validate({ body: updateProductSchema }), updateProduct);
router.patch("/:id/variants/:variantId", validate({ body: updateVariantSchema }), updateVariant);
router.delete("/:id", deleteProduct);

export default router;
