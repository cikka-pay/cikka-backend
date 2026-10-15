import { Router } from "express";
import * as adminAuth from "../controllers/admin-auth.controller";
import * as adminOnboarding from "../controllers/admin-onboarding.controller";
import * as adminCommissionAgreement from "../controllers/admin-commission-agreement.controller";
import { requireAdminAuth } from "../middleware/auth.middleware";

const router = Router();

// Auth Routes (public — these issue the admin token)
router.post("/auth/login", adminAuth.adminLogin);
router.post("/auth/verify-access-code", adminAuth.verifyAccessCode);

// Every route below requires an admin token. Applied per route (not router.use)
// so unknown /admin/* paths still fall through to the 404 handler.
router.get("/auth/me", requireAdminAuth, adminAuth.getAdminProfile);

// Seller Verification & Onboarding Feed Routes
router.get("/onboarding/applications", requireAdminAuth, adminOnboarding.getApplications);
router.get("/onboarding/applications/:sellerId", requireAdminAuth, adminOnboarding.getApplicationById);
router.patch("/onboarding/applications/:sellerId/status", requireAdminAuth, adminOnboarding.updateApplicationStatus);
router.post("/onboarding/applications/:sellerId/notify-missing-doc", requireAdminAuth, adminOnboarding.notifyMissingDocument);
router.delete("/onboarding/applications/:sellerId", requireAdminAuth, adminOnboarding.deleteApplication);
router.delete("/sellers/:sellerId", requireAdminAuth, adminOnboarding.deleteApplication);

// Approved Sellers
router.get("/sellers/approved", requireAdminAuth, adminOnboarding.getApprovedSellers);

// Company Commission Structure Routes
router.get("/sellers/:sellerId/commission", requireAdminAuth, adminCommissionAgreement.getSellerCommissionConfig);
router.put("/sellers/:sellerId/commission", requireAdminAuth, adminCommissionAgreement.updateSellerCommissionConfig);

// Customized Merchant Agreement Routes
router.get("/sellers/:sellerId/agreement", requireAdminAuth, adminCommissionAgreement.getSellerAgreementConfig);
router.put("/sellers/:sellerId/agreement", requireAdminAuth, adminCommissionAgreement.updateSellerAgreementConfig);

// Approved Sellers & Product Approvals
router.get("/sellers/:id/products", requireAdminAuth, adminOnboarding.getSellerProducts);
router.patch("/products/:id/approval", requireAdminAuth, adminOnboarding.updateProductApproval);

// Hubble Money Rewards Net for Website Admin
router.get("/hubble", requireAdminAuth, async (_req, res) => {
  try {
    const { HubbleRestClient } = await import("../services/hubble-rest.service");
    const summary = await HubbleRestClient.getHubbleAdminSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch Hubble rewards",
    });
  }
});

export default router;
