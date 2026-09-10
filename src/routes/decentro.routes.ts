import { Router } from "express";
import { handleDecentroPayoutWebhook } from "../controllers/decentro.controller";

const router = Router();

// Public Decentro Payout Webhook endpoint
router.post("/payout-webhook", handleDecentroPayoutWebhook);

export default router;
