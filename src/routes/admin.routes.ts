import { Router } from "express";
import * as adminAuth from "../controllers/admin-auth.controller";
import * as adminOnboarding from "../controllers/admin-onboarding.controller";
import * as adminCommissionAgreement from "../controllers/admin-commission-agreement.controller";

const router = Router();

// Auth Routes
router.post("/auth/login", adminAuth.adminLogin);
router.post("/auth/verify-access-code", adminAuth.verifyAccessCode);
router.get("/auth/me", adminAuth.getAdminProfile);

// Seller Verification & Onboarding Feed Routes
router.get("/onboarding/applications", adminOnboarding.getApplications);
router.get("/onboarding/applications/:sellerId", adminOnboarding.getApplicationById);
router.patch("/onboarding/applications/:sellerId/status", adminOnboarding.updateApplicationStatus);
router.post("/onboarding/applications/:sellerId/notify-missing-doc", adminOnboarding.notifyMissingDocument);
router.delete("/onboarding/applications/:sellerId", adminOnboarding.deleteApplication);
router.delete("/sellers/:sellerId", adminOnboarding.deleteApplication);

// Approved Sellers
router.get("/sellers/approved", adminOnboarding.getApprovedSellers);

// Company Commission Structure Routes
router.get("/sellers/:sellerId/commission", adminCommissionAgreement.getSellerCommissionConfig);
router.put("/sellers/:sellerId/commission", adminCommissionAgreement.updateSellerCommissionConfig);

// Customized Merchant Agreement Routes
router.get("/sellers/:sellerId/agreement", adminCommissionAgreement.getSellerAgreementConfig);
router.put("/sellers/:sellerId/agreement", adminCommissionAgreement.updateSellerAgreementConfig);

// Approved Sellers & Product Approvals
router.get("/sellers/:id/products", adminOnboarding.getSellerProducts);
router.patch("/products/:id/approval", adminOnboarding.updateProductApproval);

// Hubble Money Rewards Net for Website Admin
router.get("/hubble", async (_req, res) => {
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
