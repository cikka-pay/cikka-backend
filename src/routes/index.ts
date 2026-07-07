import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import authRoutes from "./auth.routes";
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

// Public
router.use("/auth", authRoutes);

// Everything below requires a valid JWT
router.use(requireAuth);
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
