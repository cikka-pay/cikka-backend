import { Router } from "express";
import { requireSellerAuth, requireUserAuth, optionalUserAuth } from "../middleware/auth.middleware";
import { config } from "../config/env";
import authRoutes from "./auth.routes";
import userAuthRoutes from "./user-auth.routes";
import billpayRoutes from "./billpay.routes";
import billpayHistoryRoutes from "./billpayHistory.routes";
import billpayWebhookRoutes from "./billpayWebhook.routes";
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
import userOrdersRoutes from "./user-orders.routes";
import walletRoutes from "./wallet.routes";

import hubbleRoutes from "./hubble.routes";
import razorpayRouteRoutes, { razorpayWebhookRouter } from "./razorpay-route.routes";

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
router.use("/user/orders", userOrdersRoutes);
router.use("/cards", cardsRoutes);
router.use("/user/cards", cardsRoutes);
// BBPS bill pay via Setu pre-built screens (spec 002): /api/bbps/session, /api/bbps/history[/:id]
router.use("/bbps", billpayHistoryRoutes);
router.use("/bbps", billpayRoutes);
// Setu BillPay webhook (X-BILL-WEBHOOK-API-KEY auth, no JWT)
router.use("/webhooks/setu/billpay", billpayWebhookRoutes);
router.use("/kyc", instantpayRoutes);
router.use("/instantpay", instantpayRoutes);
router.use("/pan", instantpayRoutes);
router.use("/hubble", hubbleRoutes);
router.use("/hubble.sso", hubbleRoutes);

// User Wallet — CI Points & cashback double-entry ledger
router.use("/wallet", walletRoutes);

// Razorpay Route Split & Settlement Routes (/api/razorpay-route/*)
router.use("/razorpay-route", razorpayRouteRoutes);
router.use("/webhooks/razorpay", razorpayWebhookRouter);

// Razorpay Payment Endpoints (/api/payment/create-order & /api/payment/verify-payment)
router.use("/payment", paymentRoutes);

// Rewards Store Redemption Endpoints (/api/rewards/initiate-redemption & /api/rewards/confirm-redemption)
router.use("/rewards", rewardsRoutes);

// Shipway Experience Endpoints (/api/shipway/...)
router.use("/shipway", shipwayRoutes);


// Customer return / exchange requests (mobile app). They trigger refunds and payout
// reversals, so a signed-in user is required.
import { createReturn, createExchange, exchangeEligibility } from "../controllers/returns.controller";
router.get("/returns/exchange/eligibility", requireUserAuth, exchangeEligibility);
router.post("/returns/exchange/eligibility", requireUserAuth, exchangeEligibility);
router.post("/returns/request", requireUserAuth, createReturn);
router.post("/returns/create", requireUserAuth, createReturn);
router.post("/returns/exchange", requireUserAuth, createExchange);

// Public Cikka Mall Catalog (Product exploration & single-loop exchanges)
import { listMallCatalogProducts } from "../controllers/products.controller";
import { createOrder } from "../controllers/orders.controller";
import { quoteMallCart } from "../controllers/mall.controller";
router.get("/mall/products", listMallCatalogProducts);
router.get("/products/mall", listMallCatalogProducts);
// Server-side cart pricing (spec 003): user JWT optional (needed for cashback / exchanges)
router.post("/mall/quote", optionalUserAuth, quoteMallCart);
// Order simulation endpoint for local testing only: it writes orders with arbitrary totals,
// so it does not exist in production.
if (!config.isProduction) {
  router.post("/orders/create", createOrder);
}



// Onboarding Routes (has internal requireAuth for protected routes, plus open /validate-domain utility)
router.use("/onboarding", onboardingRoutes);

// Public Products Catalog Endpoint (Mobile App & Public Browse; protected mutations handled internally)
router.use("/products", productsRoutes);

// Protected Seller Routes — require a valid Seller JWT. Auth is attached per mount (not as a
// catch-all), so an unknown /api path falls through to the app's 404 instead of a 401.
router.use("/dashboard", requireSellerAuth, dashboardRoutes);
router.use("/orders", requireSellerAuth, ordersRoutes);
router.use("/inventory", requireSellerAuth, inventoryRoutes);
router.use("/settlements", requireSellerAuth, settlementsRoutes);
router.use("/returns", requireSellerAuth, returnsRoutes);
router.use("/notifications", requireSellerAuth, notificationsRoutes);
router.use("/settings", requireSellerAuth, settingsRoutes);
router.use("/team", requireSellerAuth, teamRoutes);

export default router;

