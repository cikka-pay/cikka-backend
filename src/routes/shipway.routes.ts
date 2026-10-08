import { Router } from "express";
import {
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

// Push Order Data to Shipway
router.post("/push-order", pushOrder);
router.post("/pushOrderData", pushOrder);

// Get Order Shipment Tracking Details
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

// Webhook Receiver Callback
router.post("/webhook", handleWebhook);

export default router;

