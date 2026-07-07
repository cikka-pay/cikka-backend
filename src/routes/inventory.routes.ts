import { Router } from "express";
import { getAlerts, restock } from "../controllers/inventory.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const restockSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
});

router.get("/alerts", getAlerts);
router.patch("/restock", validate({ body: restockSchema }), restock);

export default router;
