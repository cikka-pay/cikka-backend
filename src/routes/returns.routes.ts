import { Router } from "express";
import { listReturns } from "../controllers/returns.controller";

const router = Router();

router.get("/", listReturns);

export default router;
