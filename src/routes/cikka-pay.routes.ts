import { Router } from "express";
import {
  getBillers,
  getBillerDetails,
  validateCustomer,
  fetchBill,
  getBillDetails,
  payBill,
  getTransactions,
  getTransactionById,
  getTransactionReceipt,
  getSettlements,
  reconcilePending,
} from "../controllers/cikka-pay.controller";
import { optionalUserAuth, requireUserAuth } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import {
  validateCustomerSchema,
  fetchBillSchema,
  payBillSchema,
} from "../validations/cikka-pay.validation";

const router = Router();

// Biller Discovery (Public)
router.get("/billers", getBillers);
router.get("/billers/:billerId", getBillerDetails);

// Customer Validation
router.post("/validate", validate({ body: validateCustomerSchema }), validateCustomer);

// Fetch Bill
router.post("/fetch-bill", optionalUserAuth, validate({ body: fetchBillSchema }), fetchBill);

// Bill Details by platformBillId
router.get("/bills/:platformBillId", getBillDetails);

// Bill Payment Fulfilment (Strictly requires authenticated user for rewards credit)
router.post("/pay", requireUserAuth, validate({ body: payBillSchema }), payBill);

// Transaction History & Tracking
router.get("/transactions", requireUserAuth, getTransactions);
router.get("/transactions/:id", getTransactionById);
router.get("/transactions/:id/receipt", getTransactionReceipt);

// Settlement & Reconciliation (Admin / Ops Guarded)
router.get("/settlements", requireUserAuth, getSettlements);
router.post("/reconcile", requireUserAuth, reconcilePending);

export default router;
