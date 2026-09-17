import { Router } from "express";
import { sendWaitlistEmailHandler, sendWelcomeEmailHandler } from "../controllers/email.controller";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

router.post("/seller-waitlist", requireAuth, sendWaitlistEmailHandler);
router.post("/seller-welcome", requireAuth, sendWelcomeEmailHandler);

export default router;

