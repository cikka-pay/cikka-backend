import { Router } from "express";
import { requireSellerAuth } from "../middleware/auth.middleware";
import authRoutes from "./auth.routes";
import userAuthRoutes from "./user-auth.routes";
import setuRoutes from "./setu.routes";
import bbpsRoutes from "./bbps.routes";
import instantpayRoutes from "./instantpay.routes";
import onboardingRoutes from "./onboarding.routes";
import adminRoutes from "./admin.routes";

import dashboardRoutes from "./dashboard.routes";
import productsRoutes from "./products.routes";
import ordersRoutes from "./orders.routes";
import inventoryRoutes from "./inventory.routes";
import settlementsRoutes from "./settlements.routes";
import returnsRoutes from "./returns.routes";
import notificationsRoutes from "./notifications.routes";
import settingsRoutes from "./settings.routes";
import teamRoutes from "./team.routes";

import paymentRoutes from "./payment.routes";
import rewardsRoutes from "./rewards.routes";
import shipwayRoutes from "./shipway.routes";
import userAddressRoutes from "./user-address.routes";
import cardsRoutes from "./cards.routes";

import hubbleRoutes from "./hubble.routes";
import razorpayRouteRoutes from "./razorpay-route.routes";

import emailRoutes from "./email.routes";
import { filesRouter, uploadsRouter } from "./files.routes";


const router = Router();

// Stored files (public, read-only) and image uploads (seller or mobile-user JWT)
router.use("/files", filesRouter);
router.use("/uploads", uploadsRouter);

// Email notification routes
router.use("/email", emailRoutes);

// Admin Routes (Confidential Seller Dashboard Admin)
router.use("/admin", adminRoutes);


// Public / Non-Seller Auth Routes
router.use("/auth", authRoutes);
router.use("/user-auth", userAuthRoutes);
router.use("/customer-auth", userAuthRoutes); // Backward compatibility alias
router.use("/user/address", userAddressRoutes);
router.use("/user/addresses", userAddressRoutes);
router.use("/user-address", userAddressRoutes);
router.use("/cards", cardsRoutes);
router.use("/user/cards", cardsRoutes);
router.use("/setu/v1", setuRoutes);
router.use("/bbps", bbpsRoutes);
router.use("/kyc", instantpayRoutes);
router.use("/instantpay", instantpayRoutes);
router.use("/pan", instantpayRoutes);
router.use("/hubble", hubbleRoutes);
router.use("/hubble.sso", hubbleRoutes);

// Razorpay Route Split & Settlement Routes (/api/razorpay-route/*)
router.use("/razorpay-route", razorpayRouteRoutes);
router.use("/webhooks/razorpay", razorpayRouteRoutes);

// Razorpay Payment Endpoints (/api/payment/create-order & /api/payment/verify-payment)
router.use("/payment", paymentRoutes);

// Rewards Store Redemption Endpoints (/api/rewards/initiate-redemption & /api/rewards/confirm-redemption)
router.use("/rewards", rewardsRoutes);

// Shipway Experience Endpoints (/api/shipway/...)
router.use("/shipway", shipwayRoutes);


// Public Return Request Endpoint (Customer App / Postman)
import { createReturn } from "../controllers/returns.controller";
router.post("/returns/request", createReturn);
router.post("/returns/create", createReturn);



// Onboarding Routes (has internal requireAuth for protected routes, plus open /validate-domain utility)
router.use("/onboarding", onboardingRoutes);

// Protected Seller Routes — require valid Seller JWT
router.use(requireSellerAuth);
router.use("/dashboard", dashboardRoutes);
router.use("/products", productsRoutes);
router.use("/orders", ordersRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/settlements", settlementsRoutes);
router.use("/returns", returnsRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/settings", settingsRoutes);
router.use("/team", teamRoutes);

export default router;

