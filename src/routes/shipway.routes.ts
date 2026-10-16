import { Router } from "express";
import {
  dispatchOrder,
  bookReversePickup,
  resolveNdr,
  getShipwayDashboardStats,
  getShippingLabel,
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

import { requireAdminAuth, requireAnyAuth, requireSellerAuth } from "../middleware/auth.middleware";

const router = Router();

// Seller Operations Endpoints — scoped to req.seller.id
router.post("/dispatch-order", requireSellerAuth, dispatchOrder);
router.post("/reverse-pickup", requireSellerAuth, bookReversePickup);
router.post("/ndr-action", requireSellerAuth, resolveNdr);
router.get("/dashboard-stats", requireSellerAuth, getShipwayDashboardStats);
router.get("/label/:id", requireSellerAuth, getShippingLabel);

// Push Order Data to Shipway (seller dashboard or signed-in app user)
router.post("/push-order", requireAnyAuth, pushOrder);
router.post("/pushOrderData", requireAnyAuth, pushOrder);

// Get Order Shipment Tracking Details (Forward and Reverse)
router.get("/tracking/:orderId", getShipmentDetails);
router.get("/tracking", getShipmentDetails);
router.post("/tracking", getShipmentDetails);
router.post("/getOrderShipmentDetails", getShipmentDetails);

// Rate Comparison & Carrier Selection APIs
router.get("/rates", getCarrierRates);
router.get("/getshipwaycarrierrates", getCarrierRates);
router.get("/carriers", getCarriers);
router.get("/getcarrier", getCarriers);
router.get("/pincode-serviceable", checkPincodeServiceable);
router.get("/pincodeserviceable", checkPincodeServiceable);
router.get("/optimal-carrier", getOptimalCarrier);

// Webhook Configuration — admin only
router.post("/webhooks/add", requireAdminAuth, addWebhooks);
router.post("/addwebhooks", requireAdminAuth, addWebhooks);
router.post("/webhooks/delete", requireAdminAuth, deleteWebhooks);
router.post("/delete_webhooks", requireAdminAuth, deleteWebhooks);

// Webhook Receiver Callback (Public for Shipway webhook engine)
router.post("/webhook", handleWebhook);

export default router;
