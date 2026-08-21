import { Router } from "express";
import {
  getCategories,
  getBillers,
  getBillerDetails,
  fetchBill,
  initiateBbpsPayment,
  createPaymentOrder,
  getPaymentStatus,
  getBbpsHistory,
} from "../controllers/bbps.controller";
import { requireUserAuth, optionalUserAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  getBillersSchema,
  fetchBillSchema,
  initiateBbpsPaymentSchema,
  createPaymentOrderSchema,
} from "../validations/bbps.validation";

const router = Router();

// Category and Biller discovery (Public)
router.get("/categories", getCategories);
router.get("/billers", validate({ query: getBillersSchema }), getBillers);
router.get("/billers/:billerId", getBillerDetails);

// Fetch Bill (Public / Optional User Auth)
router.post("/fetch-bill", optionalUserAuth, validate({ body: fetchBillSchema }), fetchBill);
router.post("/bills/fetch", optionalUserAuth, validate({ body: fetchBillSchema }), fetchBill);

// Create Payment Order / Initiate Payment
router.post(
  "/create-payment-order",
  optionalUserAuth,
  validate({ body: createPaymentOrderSchema }),
  createPaymentOrder
);
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
