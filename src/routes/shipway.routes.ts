import { Router } from "express";
import {
  dispatchOrder,
  bookReversePickup,
  resolveNdr,
  getShipwayDashboardStats,
  getShippingLabel,
  printShippingLabel,
  pushOrder,
  getShipmentDetails,
  addWebhooks,
  deleteWebhooks,
  handleWebhook,
  getCarrierRates,
  getCarriers,
  checkPincodeServiceable,
  getOptimalCarrier,
} from "../controllers/shipway.controller";

import { requireSellerOrAdminAuth } from "../middleware/auth.middleware";

const router = Router();

// Seller Operations Endpoints (Protected: Requires Seller or Admin authentication)
router.post("/dispatch-order", requireSellerOrAdminAuth, dispatchOrder);
router.post("/reverse-pickup", requireSellerOrAdminAuth, bookReversePickup);
router.post("/ndr-action", requireSellerOrAdminAuth, resolveNdr);
router.get("/dashboard-stats", requireSellerOrAdminAuth, getShipwayDashboardStats);
router.get("/label/:id/print", requireSellerOrAdminAuth, printShippingLabel);
router.get("/label/:id", requireSellerOrAdminAuth, getShippingLabel);

// Push Order Data to Shipway
router.post("/push-order", requireSellerOrAdminAuth, pushOrder);
router.post("/pushOrderData", requireSellerOrAdminAuth, pushOrder);

// Get Order Shipment Tracking Details (Forward and Reverse - Public for Customers/Sellers)
router.get("/tracking/:orderId", getShipmentDetails);
router.get("/tracking", getShipmentDetails);
router.post("/tracking", getShipmentDetails);
router.post("/getOrderShipmentDetails", getShipmentDetails);

// Rate Comparison & Carrier Selection APIs (Public Calculation Helpers)
router.get("/rates", getCarrierRates);
router.get("/getshipwaycarrierrates", getCarrierRates);
router.get("/carriers", getCarriers);
router.get("/getcarrier", getCarriers);
router.get("/pincode-serviceable", checkPincodeServiceable);
router.get("/pincodeserviceable", checkPincodeServiceable);
router.get("/optimal-carrier", getOptimalCarrier);

// Webhook Configuration (Protected: Admin or Seller configuration)
router.post("/webhooks/add", requireSellerOrAdminAuth, addWebhooks);
router.post("/addwebhooks", requireSellerOrAdminAuth, addWebhooks);
router.post("/webhooks/delete", requireSellerOrAdminAuth, deleteWebhooks);
router.post("/delete_webhooks", requireSellerOrAdminAuth, deleteWebhooks);

// Webhook Receiver Callback (Public for Shipway webhook engine)
router.post("/webhook", handleWebhook);

export default router;
