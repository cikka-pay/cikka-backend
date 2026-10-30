import { Router } from "express";
import { requireUserAuth } from "../middleware/auth.middleware";
import {
  getWalletBalance,
  getWalletLedger,
  earnPoints,
  earnCashback,
  withdrawFunds,
} from "../controllers/wallet.controller";

const router = Router();

// All wallet routes require a valid user JWT
router.use(requireUserAuth);

// GET  /api/wallet/balance       — authoritative balance (replaces AsyncStorage)
router.get("/balance", getWalletBalance);

// GET  /api/wallet/ledger        — paginated transaction history
router.get("/ledger", getWalletLedger);

// POST /api/wallet/earn-points   — credit CI Points for a purchase/event
router.post("/earn-points", earnPoints);

// POST /api/wallet/earn-cashback — credit ₹5 (or any) cashback in paise
router.post("/earn-cashback", earnCashback);

// POST /api/wallet/withdraw      — withdraw cashback or CI points atomically
router.post("/withdraw", withdrawFunds);

export default router;
