import { walletService } from "../../services/wallet.service";
import { WalletTxType } from "../../generated/prisma/client";
import type { JobHandler } from "../../lib/jobs";
import type { CikkaPayload } from "../definitions";

/**
 * Credits Cikka Mall purchase rewards to the buyer's wallet.
 *
 * Idempotent: ledger keys are `EARN_ORDER:<razorpayOrderId>` and
 * `EARN_CASHBACK:<razorpayOrderId>` — the same format `/api/wallet/earn-*`
 * derives from `order_id`, so a retried job (or a client that also calls those
 * endpoints with the same order id) never double-credits.
 */
export const rewardCreditHandler: JobHandler<CikkaPayload<"reward.credit">> = async (p) => {
  const opts = { orderId: p.razorpayOrderId, razorpayPaymentId: p.razorpayPaymentId };

  if (p.ciPoints > 0) {
    await walletService.creditPoints(p.userId, p.ciPoints, WalletTxType.EARN_ORDER, {
      ...opts,
      description: `CI Points for Cikka Mall order ${p.razorpayOrderId}`,
      idempotencyKey: `${WalletTxType.EARN_ORDER}:${p.razorpayOrderId}`,
    });
  }

  const cashbackPaise = Math.round(p.cashbackRupees * 100);
  if (cashbackPaise > 0) {
    await walletService.creditCash(p.userId, cashbackPaise, WalletTxType.EARN_CASHBACK, {
      ...opts,
      description: `₹${(cashbackPaise / 100).toFixed(2)} cashback for Cikka Mall order ${p.razorpayOrderId}`,
      idempotencyKey: `${WalletTxType.EARN_CASHBACK}:${p.razorpayOrderId}`,
    });
  }
};
