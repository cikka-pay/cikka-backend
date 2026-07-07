import { Router } from "express";
import { getProfile, getSettings, updateSettings } from "../controllers/settings.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const updateSettingsSchema = z.object({
  notifyLowStock: z.boolean().optional(),
  notifyNewOrder: z.boolean().optional(),
  notifySettlement: z.boolean().optional(),
});

router.get("/profile", getProfile);
router.get("/", getSettings);
router.patch("/", validate({ body: updateSettingsSchema }), updateSettings);

export default router;
