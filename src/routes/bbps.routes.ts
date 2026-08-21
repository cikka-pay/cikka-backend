import { Router } from "express";
import { getCategories, getBillers, fetchBill, createPaymentOrder } from "../controllers/bbps.controller";
import { validate } from "../middleware/validate.middleware";
import { getBillersSchema, fetchBillSchema, createPaymentOrderSchema } from "../validations/bbps.validation";

const router = Router();

/**
 * GET /api/bbps/categories
 * List all supported BBPS biller categories.
 */
router.get("/categories", getCategories);

/**
 * GET /api/bbps/billers
 * Query billers by category or keyword search.
 */
router.get("/billers", validate({ query: getBillersSchema }), getBillers);

/**
 * POST /api/bbps/fetch-bill
 * Fetch live bill details from Setu BBPS Gateway.
 */
router.post("/fetch-bill", validate({ body: fetchBillSchema }), fetchBill);

/**
 * POST /api/bbps/create-payment-order
 * Generate Setu BBPS payment order & payment intent link.
 */
router.post("/create-payment-order", validate({ body: createPaymentOrderSchema }), createPaymentOrder);

export default router;
