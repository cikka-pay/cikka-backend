import { Router } from "express";
import { requireSellerAuth } from "../middleware/auth.middleware";
import authRoutes from "./auth.routes";
import userAuthRoutes from "./user-auth.routes";
import setuRoutes from "./setu.routes";
import bbpsRoutes from "./bbps.routes";
import instantpayRoutes from "./instantpay.routes";
import onboardingRoutes from "./onboarding.routes";

import dashboardRoutes from "./dashboard.routes";
import productsRoutes from "./products.routes";
import ordersRoutes from "./orders.routes";
import inventoryRoutes from "./inventory.routes";
import settlementsRoutes from "./settlements.routes";
import returnsRoutes from "./returns.routes";
import notificationsRoutes from "./notifications.routes";
import settingsRoutes from "./settings.routes";

const router = Router();

// Public / Non-Seller Auth Routes
router.use("/auth", authRoutes);
router.use("/user-auth", userAuthRoutes);
router.use("/customer-auth", userAuthRoutes); // Backward compatibility alias
router.use("/setu/v1", setuRoutes);
router.use("/bbps", bbpsRoutes);
router.use("/kyc", instantpayRoutes);
router.use("/instantpay", instantpayRoutes);


// Protected Seller Routes — require valid Seller JWT
router.use(requireSellerAuth);
router.use("/onboarding", onboardingRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/products", productsRoutes);
router.use("/orders", ordersRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/settlements", settlementsRoutes);
router.use("/returns", returnsRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/settings", settingsRoutes);

export default router;

