import { Router } from "express";
import {
  getCategories,
  getBillers,
  getBillerDetails,
  fetchBill,
  initiateBbpsPayment,
  getPaymentStatus,
  getBbpsHistory,
} from "../controllers/bbps.controller";
import { requireUserAuth, optionalUserAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { fetchBillSchema, initiateBbpsPaymentSchema } from "../validations/bbps.validation";

const router = Router();

// Category and Biller discovery (Public)
router.get("/categories", getCategories);
router.get("/billers", getBillers);
router.get("/billers/:billerId", getBillerDetails);

// Fetch Bill (Public / Optional User Auth)
router.post("/bills/fetch", optionalUserAuth, validate({ body: fetchBillSchema }), fetchBill);

// Initiate Payment (Optional User Auth)
router.post(
  "/payments/initiate",
  optionalUserAuth,
  validate({ body: initiateBbpsPaymentSchema }),
  initiateBbpsPayment
);

// Payment Status by refID
router.get("/payments/:refID/status", getPaymentStatus);

// User Bill Payment History (Requires User Auth)
router.get("/history", requireUserAuth, getBbpsHistory);

export default router;
