import { Router } from "express";
import {
  listOrders,
  getOrder,
  updateOrderStatus,
} from "../controllers/orders.controller";
import { z } from "zod";
import { validate } from "../middleware/validate.middleware";

const router = Router();

// Zod schemas
const orderQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.enum(["ALL", "PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(["PENDING", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]),
  trackingNumber: z.string().optional(),
  courier: z.string().optional(),
});

router.get("/", validate({ query: orderQuerySchema }), listOrders);
router.get("/:id", getOrder);
router.patch("/:id/status", validate({ body: updateStatusSchema }), updateOrderStatus);

export default router;
