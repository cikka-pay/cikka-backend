import { Router } from "express";
import {
  pushOrder,
  getShipmentDetails,
  addWebhooks,
  deleteWebhooks,
  handleWebhook,
} from "../controllers/shipway.controller";

const router = Router();

// Push Order Data to Shipway
router.post("/push-order", pushOrder);
router.post("/pushOrderData", pushOrder);

// Get Order Shipment Tracking Details
router.get("/tracking/:orderId", getShipmentDetails);
router.post("/tracking", getShipmentDetails);
router.post("/getOrderShipmentDetails", getShipmentDetails);

// Webhook Configuration
router.post("/webhooks/add", addWebhooks);
router.post("/addwebhooks", addWebhooks);
router.post("/webhooks/delete", deleteWebhooks);
router.post("/delete_webhooks", deleteWebhooks);

// Webhook Receiver Callback
router.post("/webhook", handleWebhook);

export default router;
