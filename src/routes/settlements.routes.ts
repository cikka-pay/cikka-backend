import { Router } from "express";
import { listSettlements } from "../controllers/settlements.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";
import { requireRole } from "../middleware/auth.middleware";

const router = Router();

const settlementQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "PAID", "REVERSED", "FAILED"]).optional(),
});

// Strictly Admin only can view or manage settlements (Neither Executive nor Viewer can access)
router.get("/", requireRole(["ADMIN"]), validate({ query: settlementQuerySchema }), listSettlements);

// Payouts are released automatically (T+7/T+14) from settled orders. The old seller
// "withdraw any amount" and "disburse any settlement id" endpoints created payouts with no
// customer payment behind them and were not scoped to the seller; they are retired.
// Ops can still disburse via the admin-only POST /api/razorpay-route/disburse/:id.
const retired = (_req: any, res: any) =>
  res.status(410).json({ error: "Payouts are released automatically from settled orders; this endpoint is retired." });
router.post("/withdraw", requireRole(["ADMIN"]), retired);
router.post("/:id/disburse", requireRole(["ADMIN"]), retired);

export default router;
