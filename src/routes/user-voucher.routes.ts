import { Router } from "express";
import {
  listUserVouchers,
  getVoucherById,
  updateVoucherStatus,
} from "../controllers/user-voucher.controller";
import { optionalUserAuth } from "../middleware/auth.middleware";

const router = Router();

router.use(optionalUserAuth);

// List user vouchers & brand groups
router.get("/", listUserVouchers);
router.get("/my-vouchers", listUserVouchers);

// Get single voucher details
router.get("/:id", getVoucherById);

// Update status (e.g. mark REDEEMED / ACTIVE)
router.patch("/:id/status", updateVoucherStatus);
router.post("/:id/status", updateVoucherStatus);

export default router;

