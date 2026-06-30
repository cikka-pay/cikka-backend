import { Router } from "express";
import { listSettlements } from "../controllers/settlements.controller";

const router = Router();

router.get("/", listSettlements);

export default router;
