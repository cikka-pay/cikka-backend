import { Router } from "express";
import { listSettlements, createWithdrawal } from "../controllers/settlements.controller";
import { triggerRouteDisburse } from "../controllers/razorpay-route.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";
import { requireRole } from "../middleware/auth.middleware";

const router = Router();

const settlementQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "PAID"]).optional(),
});

router.get("/", validate({ query: settlementQuerySchema }), listSettlements);

// Strictly Admin only can withdraw or trigger disbursements
router.post("/withdraw", requireRole(["ADMIN"]), createWithdrawal);
router.post("/:id/disburse", requireRole(["ADMIN"]), triggerRouteDisburse);

export default router;
