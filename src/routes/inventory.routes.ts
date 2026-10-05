import { Router } from "express";
import { getAlerts, restock } from "../controllers/inventory.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";
import { requireRole } from "../middleware/auth.middleware";

const router = Router();

const restockSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().positive(),
});

router.get("/alerts", getAlerts);
router.patch("/restock", requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: restockSchema }), restock);

export default router;
