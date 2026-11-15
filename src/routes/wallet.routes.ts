import { Router } from "express";
import { requireUserAuth } from "../middleware/auth.middleware";
import {
  getWalletBalance,
  getWalletLedger,
  earnPoints,
  earnCashback,
  withdrawFunds,
  rateAppReward,
} from "../controllers/wallet.controller";

const router = Router();

// All wallet routes require a valid user JWT
router.use(requireUserAuth);

// GET  /api/wallet/balance       — authoritative balance (replaces AsyncStorage)
router.get("/balance", getWalletBalance);

// GET  /api/wallet/ledger        — paginated transaction history
router.get("/ledger", getWalletLedger);

// POST /api/wallet/withdraw      — withdraw cashback or CI points atomically
router.post("/withdraw", withdrawFunds);

// POST /api/wallet/rate-app-reward — credit 150 CI Points once per user for rating Cikka
router.post("/rate-app-reward", rateAppReward);

export default router;
