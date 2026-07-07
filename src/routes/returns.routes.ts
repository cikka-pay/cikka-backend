import { Router } from "express";
import { listReturns, updateReturnStatus } from "../controllers/returns.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const returnQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["ALL", "REQUESTED", "APPROVED", "REJECTED", "RECEIVED", "REFUNDED"]).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "RECEIVED", "REFUNDED"]),
});

router.get("/", validate({ query: returnQuerySchema }), listReturns);
router.patch("/:id/status", validate({ body: updateStatusSchema }), updateReturnStatus);

export default router;
