import { prisma } from "../config/prisma";
import { initiateDecentroPayout } from "./decentro.service";

/**
 * Computes and writes a Settlement row for a seller for a given period, based on
 * delivered orders in that window.
 */
export async function computeSettlementForPeriod(
  sellerId: string,
  periodStart: Date,
  periodEnd: Date,
  commissionRate = 21
) {
  const orders = await prisma.order.findMany({
    where: {
      sellerId,
      status: "DELIVERED",
      createdAt: { gte: periodStart, lt: periodEnd },
    },
  });

  const grossSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  const basePrice = grossSales > 0 ? grossSales / 1.18 : 0;
  const gstOnSale = grossSales - basePrice;
  const commissionAmount = basePrice * (commissionRate / 100);
  const gstOnCommission = commissionAmount * 0.18; // 18% GST on Cikka commission
  const shippingFee = orders.length > 0 ? orders.length * 150 : (grossSales > 0 ? 150 : 0); // Flat shipping fee (e.g. ₹150)
  const tdsAmount = grossSales * 0.001; // 0.1% TDS on Gross
  const tcsAmount = basePrice * 0.005;  // 0.5% TCS on Net Taxable Base Price
  const statutoryTaxes = tdsAmount + tcsAmount;
  
  const totalDeductions = commissionAmount + gstOnCommission + shippingFee + statutoryTaxes;
  const netPayable = Math.max(0, grossSales - totalDeductions);
  const shippingGstAmount = shippingFee + gstOnCommission + statutoryTaxes;

  return prisma.settlement.create({
    data: {
      sellerId,
      periodStart,
      periodEnd,
      grossSales,
      basePrice,
      gstOnSale,
      commissionRate,
      commissionAmount,
      gstOnCommission,
      shippingFee,
      tdsAmount,
      tcsAmount,
      statutoryTaxes,
      shippingGstAmount,
      netPayable,
      status: "PENDING",
      payoutDate: new Date(),
    } as any,
  });
}

/**
 * Disburses an individual settlement payout using Decentro Core Banking Payout API
 */
export async function disburseSettlement(settlementId: string) {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      seller: {
        include: {
          onboarding: true,
        },
      },
    },
  });

  if (!settlement) {
    throw new Error(`Settlement with ID ${settlementId} not found.`);
  }

  if (settlement.status === "PAID") {
    return {
      success: true,
      message: "Settlement has already been paid.",
      settlement,
    };
  }

  const onboarding = settlement.seller.onboarding;
  const bankAccountNumber = onboarding?.bankAccountNumber;
  const bankIfsc = onboarding?.bankIfsc;
  const bankAccountHolder = onboarding?.bankAccountHolder || settlement.seller.businessName || "Merchant Partner";

  if (!bankAccountNumber || !bankIfsc) {
    const errorMsg = "Seller does not have a verified bank account number or IFSC code on file.";
    await prisma.settlement.update({
      where: { id: settlementId },
      data: { failureReason: errorMsg } as any,
    });

    throw new Error(errorMsg);
  }

  const amount = Number(settlement.netPayable);
  if (amount <= 0) {
    throw new Error("Net payable amount must be greater than zero for payout disbursal.");
  }

  const referenceId = `SET_${settlementId.replace(/-/g, "").slice(0, 10)}_${Date.now().toString().slice(-4)}`;

  // Execute Decentro Payout Money Transfer
  const payoutResult = await initiateDecentroPayout({
    referenceId,
    toAccount: bankAccountNumber,
    ifscCode: bankIfsc,
    beneficiaryName: bankAccountHolder,
    amount,
    transferType: "IMPS",
    purposeMessage: `Cikka Settlement Disbursal - ${settlementId.slice(0, 8)}`,
  });

  if (payoutResult.success) {
    const updatedSettlement = await prisma.settlement.update({
      where: { id: settlementId },
      data: {
        status: payoutResult.status === "SUCCESS" ? "PAID" : "PENDING",
        decentroTxnId: payoutResult.decentroTxnId || referenceId,
        decentroUrn: payoutResult.urn,
        utr: payoutResult.utr,
        payoutDate: new Date(),
        disbursedAt: new Date(),
        failureReason: null,
      } as any,
    });

    // Notify seller
    await prisma.notification.create({
      data: {
        sellerId: settlement.sellerId,
        type: "SETTLEMENT",
        title: payoutResult.status === "SUCCESS" ? "Payout Disbursed Successfully" : "Payout Transfer Initiated",
        body: payoutResult.status === "SUCCESS"
          ? `Your net settlement payout of ₹${amount.toFixed(2)} has been transferred via IMPS (UTR: ${payoutResult.utr || "Pending"}).`
          : `Your net settlement payout of ₹${amount.toFixed(2)} is processing via Decentro Payouts.`,
        metadata: {
          settlementId,
          amount,
          utr: payoutResult.utr,
          decentroTxnId: payoutResult.decentroTxnId,
        },
      },
    });

    return {
      success: true,
      status: payoutResult.status,
      settlement: updatedSettlement,
      payoutResult,
    };
  } else {
    // Record Failure
    const failureMsg = payoutResult.error || payoutResult.message || "Decentro Payout transfer failed.";
    const failedSettlement = await prisma.settlement.update({
      where: { id: settlementId },
      data: {
        failureReason: failureMsg,
      } as any,
    });

    return {
      success: false,
      status: "FAILED",
      error: failureMsg,
      settlement: failedSettlement,
      payoutResult,
    };
  }
}

/**
 * Processes all pending due settlements
 */
export async function processPendingSettlements() {
  const pendingSettlements = await prisma.settlement.findMany({
    where: {
      status: "PENDING",
      payoutDate: { lte: new Date() },
    },
    take: 50,
  });

  const results = [];
  for (const s of pendingSettlements) {
    try {
      const res = await disburseSettlement(s.id);
      results.push(res);
    } catch (err: any) {
      results.push({ settlementId: s.id, success: false, error: err.message });
    }
  }

  return results;
}
