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

const router = Router();

// Seller Operations Endpoints
router.post("/dispatch-order", dispatchOrder);
router.post("/reverse-pickup", bookReversePickup);
router.post("/ndr-action", resolveNdr);
router.get("/dashboard-stats", getShipwayDashboardStats);
router.get("/label/:id/print", printShippingLabel);
router.get("/label/:id", getShippingLabel);

// Push Order Data to Shipway
router.post("/push-order", pushOrder);
router.post("/pushOrderData", pushOrder);

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

// Webhook Configuration
router.post("/webhooks/add", addWebhooks);
router.post("/addwebhooks", addWebhooks);
router.post("/webhooks/delete", deleteWebhooks);
router.post("/delete_webhooks", deleteWebhooks);

// Webhook Receiver Callback (Public for Shipway webhook engine)
router.post("/webhook", handleWebhook);

export default router;
