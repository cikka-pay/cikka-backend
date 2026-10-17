import { Router } from "express";
import { z } from "zod";
import {
  createOrder,
  getOrder,
  listOrders,
  updateOrderStatus,
} from "../controllers/orders.controller";
import { validate } from "../middleware/validate.middleware";
import { requireRole } from "../middleware/auth.middleware";

const router = Router();

// Zod schemas
const orderQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  productId: z.string().optional(),
  search: z.string().optional(),
  status: z
    .preprocess(
      (val) => (typeof val === "string" ? val.toUpperCase() : val),
      z.enum(["ALL", "PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED", "RETURNS"]).optional()
    )
    .transform((val) => (val === "RETURNS" ? "RETURNED" : val)),
});

const updateStatusSchema = z.object({
  status: z.enum(["PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]),
  trackingNumber: z.string().optional(),
  courier: z.string().optional(),
});

router.get("/", validate({ query: orderQuerySchema }), listOrders);
router.post("/", createOrder);
router.get("/:id", getOrder);
router.patch("/:id/status", requireRole(["ADMIN", "EXECUTIVE"]), validate({ body: updateStatusSchema }), updateOrderStatus);

export default router;
