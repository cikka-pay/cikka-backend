import { Router } from "express";
import { getUserAddress, saveUserAddress } from "../controllers/user-address.controller";

const router = Router();

router.get("/", getUserAddress);
router.get("/address", getUserAddress);
router.post("/", saveUserAddress);
router.post("/address", saveUserAddress);

export default router;
