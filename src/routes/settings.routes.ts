import { Router } from "express";
import { getProfile, getSettings, updateSettings, updateProfile } from "../controllers/settings.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const updateSettingsSchema = z.object({
  // Notification preferences
  notifyLowStock:   z.boolean().optional(),
  notifyNewOrder:   z.boolean().optional(),
  notifySettlement: z.boolean().optional(),
  // Operational preferences
  settlementCycle:  z.enum(["T_PLUS_1", "T_PLUS_3", "T_PLUS_7", "T_PLUS_14"]).optional(),
  returnPolicy:     z.string().optional(),
  fulfillmentType:  z.enum(["SELF", "THREE_PL", "CIKKA"]).optional(),
  lowStockDefault:  z.number().int().min(0).optional(),
});

import { requireRole } from "../middleware/auth.middleware";

router.get("/profile", getProfile);
router.patch("/profile", requireRole(["ADMIN"]), updateProfile);
router.get("/", getSettings);
router.patch("/", requireRole(["ADMIN"]), validate({ body: updateSettingsSchema }), updateSettings);

export default router;

