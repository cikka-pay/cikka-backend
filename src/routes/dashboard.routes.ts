import { Router } from "express";
import { getSummary, getSettlementBreakdown } from "../controllers/dashboard.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const breakdownQuerySchema = z.object({
  period: z.enum(["week", "month"]).optional(),
});

router.get("/summary", getSummary);
router.get("/settlement-breakdown", validate({ query: breakdownQuerySchema }), getSettlementBreakdown);

export default router;
