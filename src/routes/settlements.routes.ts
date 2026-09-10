import { Router } from "express";
import { listSettlements, createWithdrawal } from "../controllers/settlements.controller";
import { triggerPayoutDisburse } from "../controllers/decentro.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const settlementQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "PAID"]).optional(),
});

router.get("/", validate({ query: settlementQuerySchema }), listSettlements);
router.post("/withdraw", createWithdrawal);
router.post("/:id/disburse", triggerPayoutDisburse);

export default router;
