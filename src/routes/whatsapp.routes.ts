import { Router } from "express";
import { handleWhatsappWebhook, verifyWhatsappWebhook } from "../controllers/whatsapp-webhook.controller";

const router = Router();

// Meta WhatsApp Cloud API Inbound Webhook routes
router.get("/", verifyWhatsappWebhook);
router.post("/", handleWhatsappWebhook);

router.get("/webhook", verifyWhatsappWebhook);
router.post("/webhook", handleWhatsappWebhook);

export default router;
