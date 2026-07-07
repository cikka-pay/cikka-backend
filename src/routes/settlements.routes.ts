import { Router } from "express";
import { listSettlements } from "../controllers/settlements.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const settlementQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "PAID"]).optional(),
});

router.get("/", validate({ query: settlementQuerySchema }), listSettlements);

export default router;
