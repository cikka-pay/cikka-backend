import { config } from "../../config/env";
import { prisma } from "../../config/prisma";
import { getSetuHeaders } from "./setuAuth.service";
import { Prisma } from "../../generated/prisma/client";

export interface SettlementRecordOutput {
  id: string;
  settlementReference: string;
  amount: number;
  utr?: string | null;
  ifsc?: string | null;
  instrument?: string | null;
  reconciliationStatus: string;
  createdAt: string;
}

/**
 * Retrieves settlement reports and transaction reconciliation state.
 */
export async function getSettlementReportsService(): Promise<SettlementRecordOutput[]> {
  try {
    const headers = await getSetuHeaders();
    const url = `${config.setuBaseUrl.replace(/\/+$/, "")}/utilities/settlements`;

    const response = await fetch(url, { method: "GET", headers });
    if (response.ok) {
      const data: any = await response.json();
      const records = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      for (const r of records) {
        if (r.settlementReference) {
          await prisma.bbpsSettlement.upsert({
            where: { settlementReference: r.settlementReference },
            update: {
              amount: r.amount || 0,
              utr: r.utr,
              ifsc: r.ifsc,
              instrument: r.instrument,
              reconciliationStatus: r.reconciliationStatus || "RECONCILED",
            },
            create: {
              settlementReference: r.settlementReference,
              amount: r.amount || 0,
              utr: r.utr,
              ifsc: r.ifsc,
              instrument: r.instrument,
              reconciliationStatus: r.reconciliationStatus || "RECONCILED",
              transactionDetails: r as unknown as Prisma.InputJsonValue,
            },
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(`[SetuSettlementService] Live settlement sync skipped: ${err.message}`);
  }

  let settlements: any[] = [];
  try {
    settlements = await prisma.bbpsSettlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } catch (_e) {}

  return settlements.map((s) => ({
    id: s.id,
    settlementReference: s.settlementReference,
    amount: parseFloat(s.amount.toString()),
    utr: s.utr,
    ifsc: s.ifsc,
    instrument: s.instrument,
    reconciliationStatus: s.reconciliationStatus,
    createdAt: s.createdAt.toISOString(),
  }));
}

/**
 * Reconciles transactions that are in PENDING or RECONCILIATION_REQUIRED status.
 */
export async function reconcileTransactionsService(): Promise<{ reconciledCount: number }> {
  let pendingTxns: any[] = [];
  try {
    pendingTxns = await prisma.bbpsTransaction.findMany({
      where: {
        status: { in: ["PENDING", "RECONCILIATION_REQUIRED"] },
      },
      take: 20,
    });
  } catch (_e) {}

  let reconciledCount = 0;

  for (const tx of pendingTxns) {
    try {
      if (tx.platformBillId) {
        const headers = await getSetuHeaders();
        const url = `${config.setuBaseUrl.replace(/\/+$/, "")}/utilities/bills/${encodeURIComponent(tx.platformBillId)}`;
        const response = await fetch(url, { method: "GET", headers });

        if (response.ok) {
          const data: any = await response.json();
          const billStatus = (data.status || data.data?.status || "").toUpperCase();

          if (billStatus === "PAID" || billStatus === "SUCCESS") {
            await prisma.bbpsTransaction.update({
              where: { id: tx.id },
              data: {
                status: "SUCCESS",
                receiptNumber: tx.receiptNumber || `RCT-${tx.internalTxnId.slice(-8)}`,
                receiptDate: new Date(),
              },
            });
            reconciledCount++;
          } else if (billStatus === "FAILED") {
            await prisma.bbpsTransaction.update({
              where: { id: tx.id },
              data: { status: "FAILED" },
            });
            reconciledCount++;
          }
        }
      }
    } catch (_e) {}
  }

  return { reconciledCount };
}
