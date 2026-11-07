import { Router } from "express";
import { requireUserAuth } from "../middleware/auth.middleware";
import { getMyOrder, listMyOrders } from "../controllers/user-orders.controller";

const router = Router();

// Buyer order history: scoped to Order.userId = req.user.id (spec 003 §6)
router.use(requireUserAuth);
router.get("/my-orders", listMyOrders);
router.get("/", listMyOrders);
router.get("/:id", getMyOrder);

export default router;
