import { Router } from "express";
import { listOrders, getOrder } from "../controllers/orders.controller";

const router = Router();

router.get("/", listOrders);
router.get("/:id", getOrder);

export default router;
