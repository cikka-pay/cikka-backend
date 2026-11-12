/**
 * billpayHistory.service.ts — the caller's BBPS bill payments (spec 002), read from the
 * BbpsTransaction rows written by the Setu BillPay webhook. Always scoped to one userId.
 */

import type { BbpsTransaction } from "../generated/prisma/client";
import { prisma } from "../config/prisma";

export const BILLPAY_HISTORY_LIMIT = 50;

export interface BillpayHistoryItem {
  id: string;
  setuOrderId: string | null;
  bbpsTxnId: string | null;
  refId: string | null;
  billerId: string | null;
  billerName: string | null;
  category: string | null;
  mobileNumber: string | null;
  billAmount: string | null; // "601.00"
  amountPaid: string | null; // "601.00"
  status: BbpsTransaction["status"];
  paidOn: string | null; // ISO-8601
  errorCode: string | null;
  errorMessage: string | null;
  disputeRefId: string | null;
  disputeStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

function money(v: BbpsTransaction["billAmount"]): string | null {
  return v == null ? null : v.toFixed(2);
}

export function toBillpayHistoryItem(tx: BbpsTransaction): BillpayHistoryItem {
  return {
    id: tx.id,
    setuOrderId: tx.setuOrderId,
    bbpsTxnId: tx.bbpsTxnId,
    refId: tx.refId,
    billerId: tx.billerId,
    billerName: tx.billerName,
    category: tx.category,
    mobileNumber: tx.mobileNumber,
    billAmount: money(tx.billAmount),
    amountPaid: money(tx.amountPaid),
    status: tx.status,
    paidOn: tx.paidOn ? tx.paidOn.toISOString() : null,
    errorCode: tx.errorCode,
    errorMessage: tx.errorMessage,
    disputeRefId: tx.disputeRefId,
    disputeStatus: tx.disputeStatus,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}

/** Last 50 bill payments of this user, newest first. */
export async function listBillpayHistory(userId: string): Promise<BillpayHistoryItem[]> {
  const rows = await prisma.bbpsTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: BILLPAY_HISTORY_LIMIT,
  });
  return rows.map(toBillpayHistoryItem);
}

/** One bill payment, only if it belongs to this user; otherwise null (→ 404). */
export async function getBillpayHistoryItem(userId: string, id: string): Promise<BillpayHistoryItem | null> {
  const row = await prisma.bbpsTransaction.findFirst({ where: { id, userId } });
  return row ? toBillpayHistoryItem(row) : null;
}
