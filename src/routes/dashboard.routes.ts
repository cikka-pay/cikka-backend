import { Router } from "express";
import { getSummary, getSettlementBreakdown } from "../controllers/dashboard.controller";

const router = Router();

router.get("/summary", getSummary);
router.get("/settlement-breakdown", getSettlementBreakdown);

export default router;
