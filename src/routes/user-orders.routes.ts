import { Router } from "express";
import { cancelUserOrder, listUserOrders } from "../controllers/orders.controller";
import { requireUserAuth } from "../middleware/auth.middleware";

/**
 * Customer-facing order routes (/api/user/orders, /api/user-orders).
 * Every route requires a valid user JWT; handlers scope all queries to req.user.id.
 * (The seller orders router must never be mounted here — it sits behind requireSellerAuth.)
 */
const router = Router();

router.use(requireUserAuth);

router.get("/", listUserOrders);
router.get("/user", listUserOrders);
router.get("/my-orders", listUserOrders);
router.post("/:id/cancel", cancelUserOrder);

export default router;
