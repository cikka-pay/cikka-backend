import { Router } from "express";
import { getAlerts } from "../controllers/inventory.controller";

const router = Router();

router.get("/alerts", getAlerts);

export default router;
