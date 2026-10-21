import { Router } from "express";
import {
  getUserAddress,
  saveUserAddress,
  deleteUserAddress,
} from "../controllers/user-address.controller";

const router = Router();

// GET all addresses / default address
router.get("/", getUserAddress);
router.get("/address", getUserAddress);
router.get("/addresses", getUserAddress);

// POST save / create address
router.post("/", saveUserAddress);
router.post("/address", saveUserAddress);
router.post("/addresses", saveUserAddress);

// DELETE address by ID
router.delete("/:id", deleteUserAddress);
router.delete("/addresses/:id", deleteUserAddress);

export default router;
