import { Router } from "express";
import { requireAdminAuth, requireUserAuth } from "../middleware/auth.middleware";
import {
  getWalletBalance,
  getWalletLedger,
  earnPoints,
  earnCashback,
  withdrawFunds,
} from "../controllers/wallet.controller";

const router = Router();

// Credits are admin-only (body: user_id). They used to sit behind the user JWT, which let any
// signed-in user mint CI Points / cashback for themselves.
router.post("/earn-points", requireAdminAuth, earnPoints);
router.post("/earn-cashback", requireAdminAuth, earnCashback);

// Everything else is the signed-in user's own wallet
router.use(requireUserAuth);

// GET  /api/wallet/balance       — authoritative balance (replaces AsyncStorage)
router.get("/balance", getWalletBalance);

// GET  /api/wallet/ledger        — paginated transaction history
router.get("/ledger", getWalletLedger);

// POST /api/wallet/withdraw      — withdraw cashback or CI points atomically
router.post("/withdraw", withdrawFunds);

export default router;
