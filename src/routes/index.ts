import { Router } from "express";
import { optionalUserAuth, requireSellerAuth } from "../middleware/auth.middleware";
import adminRoutes from "./admin.routes";
import authRoutes from "./auth.routes";
import userAuthRoutes from "./user-auth.routes";
import billpayRoutes from "./billpay.routes";
import billpayHistoryRoutes from "./billpayHistory.routes";
import billpayWebhookRoutes from "./billpayWebhook.routes";
import instantpayRoutes from "./instantpay.routes";
import onboardingRoutes from "./onboarding.routes";

import dashboardRoutes from "./dashboard.routes";
import inventoryRoutes from "./inventory.routes";
import notificationsRoutes from "./notifications.routes";
import ordersRoutes from "./orders.routes";
import productsRoutes from "./products.routes";
import returnsRoutes from "./returns.routes";
import settingsRoutes from "./settings.routes";
import settlementsRoutes from "./settlements.routes";
import teamRoutes from "./team.routes";

import cardsRoutes from "./cards.routes";
import paymentRoutes from "./payment.routes";
import reviewsRoutes from "./reviews.routes";
import rewardsRoutes from "./rewards.routes";
import shipwayRoutes from "./shipway.routes";
import whatsappRoutes from "./whatsapp.routes";
import userAddressRoutes from "./user-address.routes";
import userNotificationRoutes from "./user-notification.routes";
import userOrdersRoutes from "./user-orders.routes";
import userVoucherRoutes from "./user-voucher.routes";
import walletRoutes from "./wallet.routes";

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
router.use("/user/orders", userOrdersRoutes);
router.use("/user-orders", userOrdersRoutes);
router.use("/reviews", reviewsRoutes);
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

// User Wallet & In-App Notifications
router.use("/wallet", walletRoutes);
router.use("/user/vouchers", userVoucherRoutes);
router.use("/user-vouchers", userVoucherRoutes);
router.use("/vouchers", userVoucherRoutes);
router.use("/user-notifications", userNotificationRoutes);
router.use("/user/notifications", userNotificationRoutes);

// Razorpay Route Split & Settlement Routes (/api/razorpay-route/*)
router.use("/razorpay-route", razorpayRouteRoutes);
router.use("/webhooks/razorpay", razorpayRouteRoutes);

// Razorpay Payment Endpoints (/api/payment/create-order & /api/payment/verify-payment)
router.use("/payment", paymentRoutes);

// Rewards Store Redemption Endpoints (/api/rewards/initiate-redemption & /api/rewards/confirm-redemption)
router.use("/rewards", rewardsRoutes);

// Shipway Experience Endpoints (/api/shipway/...)
router.use("/shipway", shipwayRoutes);
// Meta WhatsApp Cloud API Webhooks (/api/whatsapp/webhook, /api/webhooks/whatsapp)
router.use("/whatsapp", whatsappRoutes);
router.use("/webhooks/whatsapp", whatsappRoutes);


// Return Request Endpoint (Customer App / Postman)
import { createExchange, createReturn } from "../controllers/returns.controller";
router.post("/returns/request", optionalUserAuth, createReturn);
router.post("/returns/create", optionalUserAuth, createReturn);
router.post("/returns/exchange", optionalUserAuth, createExchange);

// Public Cikka Mall Catalog (Product exploration & single-loop exchanges)
import { createOrder } from "../controllers/orders.controller";
import { listMallCatalogProducts, getMallQuote } from "../controllers/products.controller";
router.get("/mall/products", listMallCatalogProducts);
router.get("/products/mall", listMallCatalogProducts);
router.post("/mall/quote", optionalUserAuth, getMallQuote);
// Order simulation endpoint (customer app / Postman testing)
router.post("/orders/create", optionalUserAuth, createOrder);



// Onboarding Routes (has internal requireAuth for protected routes, plus open /validate-domain utility)
router.use("/onboarding", onboardingRoutes);

// Public Products Catalog Endpoint (Mobile App & Public Browse; protected mutations handled internally)
router.use("/products", productsRoutes);

// Protected Seller Routes — require valid Seller JWT
router.use(requireSellerAuth);
router.use("/dashboard", dashboardRoutes);
router.use("/orders", ordersRoutes);
router.use("/inventory", inventoryRoutes);
router.use("/settlements", settlementsRoutes);
router.use("/returns", returnsRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/settings", settingsRoutes);
router.use("/team", teamRoutes);

export default router;

