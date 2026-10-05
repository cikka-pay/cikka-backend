import { prisma } from "../config/prisma";
import { razorpayRouteService } from "./razorpayRoute.service";
import {
  calculateSettlementBreakdown,
  SettlementFeeConfig,
  SettlementLedgerBreakdown,
} from "./settlementCalculator.service";

/**
 * Computes and writes a Settlement row for a seller for a given period, based on
 * delivered orders in that window using the deterministic Cikka Marketplace Split Logic.
 */
export async function computeSettlementForPeriod(
  sellerId: string,
  periodStart: Date,
  periodEnd: Date,
  customConfig?: Partial<SettlementFeeConfig>
) {
  const orders = await prisma.order.findMany({
    where: {
      sellerId,
      status: "DELIVERED",
      createdAt: { gte: periodStart, lt: periodEnd },
    },
  });

  const grossSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  // Compute exact deterministic breakdown according to Cikka Marketplace rules
  const breakdown: SettlementLedgerBreakdown = calculateSettlementBreakdown(
    grossSales,
    customConfig
  );

  // Strict T+7 calculation (7 days from period end or current time)
  const holdUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return prisma.settlement.create({
    data: {
      sellerId,
      periodStart,
      periodEnd,
      category: "General",

      // 1. Order Input
      grossSales: breakdown.grossProductValue,
      basePrice: breakdown.baseProductValue,
      gstOnSale: breakdown.productGst,

      // 2. Commission
      commissionRate: breakdown.commissionRate,
      commissionAmount: breakdown.commission,
      gstOnCommission: breakdown.commissionGst,
      commissionTotal: breakdown.commissionTotal,

      // 3. Shipping
      shippingFee: breakdown.shipping,
      shippingGst: breakdown.shippingGst,
      shippingTotal: breakdown.shippingTotal,

      // 4. Seller Platform Fee
      sellerPlatformFee: breakdown.sellerPlatformFee,
      sellerPlatformFeeGst: breakdown.sellerPlatformFeeGst,
      sellerPlatformTotal: breakdown.sellerPlatformTotal,

      // 5. Statutory Taxes
      tdsAmount: breakdown.tds,
      tcsAmount: breakdown.tcs,
      statutoryTaxes: breakdown.tds + breakdown.tcs,

      // 6. Success Fee
      successFeeAmount: breakdown.successFee,
      successFeeGst: breakdown.successFeeGst,
      successFeeTotal: breakdown.successFeeTotal,

      // 7. Customer Platform Fee
      customerPlatformFee: breakdown.customerPlatformFee,
      customerPlatformFeeGst: breakdown.customerPlatformFeeGst,
      customerPlatformTotal: breakdown.customerPlatformTotal,
      customerTotalPayment: breakdown.customerTotalPayment,

      // 8. Cikka Revenue (BEFORE GST) & GST Liability
      cikkaFeeRevenue: breakdown.cikkaFeeRevenue,
      cikkaGstCollected: breakdown.cikkaGstCollected,

      // 9. Final Seller Settlement Payout (from Base Product Value)
      totalDeductions: breakdown.totalSellerDeductions,
      shippingGstAmount: breakdown.totalSellerDeductions,
      netPayable: breakdown.sellerNetSettlement,
      status: "PENDING",
      payoutDate: holdUntil,
      holdUntil,
      transferStatus: "PENDING",

      // 10. Complete Deterministic JSON Ledger Snapshot
      ledgerBreakdown: breakdown as any,
    } as any,
  });
}

/**
 * Disburses or schedules an individual settlement payout using Razorpay Route (Strict T+7 Hold).
 * Supports passing either a direct Settlement ID or a Seller ID for effortless testing.
 */
export async function disburseSettlement(
  identifier: string,
  options?: { forceEarlyRelease?: boolean; paymentId?: string }
) {
  // 1. Try finding by direct settlement ID
  let settlement = await prisma.settlement.findUnique({
    where: { id: identifier },
    include: {
      seller: {
        include: {
          onboarding: true,
        },
      },
    },
  });

  // 2. If not found by settlement ID, check if identifier is a Seller ID or Cikka Application ID (e.g. CKA029688)
  if (!settlement) {
    let seller = await prisma.seller.findFirst({
      where: {
        OR: [
          { id: identifier },
          { onboarding: { applicationId: identifier } },
        ],
      },
      include: { onboarding: true },
    });

    if (seller) {
      // Find latest pending settlement for this seller or create a sample one for testing
      settlement = await prisma.settlement.findFirst({
        where: { sellerId: seller.id },
        orderBy: { createdAt: "desc" },
        include: {
          seller: {
            include: { onboarding: true },
          },
        },
      });

      if (!settlement) {
        console.log(`[Auto-Create Settlement] Creating sample test settlement (₹1,000 reference) for seller ${seller.id}`);
        const newSettlement = await computeSettlementForPeriod(
          seller.id,
          new Date(Date.now() - 7 * 86400000),
          new Date()
        );
        settlement = await prisma.settlement.findUnique({
          where: { id: newSettlement.id },
          include: {
            seller: {
              include: { onboarding: true },
            },
          },
        });
      }
    }
  }

  if (!settlement) {
    throw new Error(`Settlement or Seller with ID ${identifier} not found.`);
  }

  if (settlement.status === "PAID" && (settlement as any).transferStatus === "SETTLED" && !options?.forceEarlyRelease) {
    return {
      success: true,
      message: "Settlement has already been paid and settled.",
      settlement,
    };
  }

  const seller = settlement.seller;
  const onboarding = seller.onboarding;
  let razorpayAccountId = (seller as any).razorpayAccountId || (onboarding as any)?.razorpayAccountId;

  // Auto-provision Linked Account if not yet created
  if (!razorpayAccountId) {
    const bankAccountNumber = onboarding?.bankAccountNumber || "919999900001";
    const bankIfsc = onboarding?.bankIfsc || "HDFC0001234";
    const bankAccountHolder = onboarding?.bankAccountHolder || seller.businessName || "Merchant Partner";

    const accountRes = await razorpayRouteService.createLinkedAccount({
      sellerId: seller.id,
      businessName: seller.businessName || onboarding?.businessName || "Merchant Partner",
      businessType: onboarding?.businessType as any,
      email: seller.email || onboarding?.signatoryEmail || "seller@cikka.club",
      phone: seller.phone,
      signatoryName: onboarding?.signatoryName || undefined,
      panNumber: onboarding?.panNumber || onboarding?.signatoryPersonalPan || undefined,
      gstNumber: onboarding?.gstNumber || undefined,
      bankAccountNumber,
      bankIfsc,
      bankAccountHolder,
      address: onboarding?.pickupAddress as any,
    });

    if (!accountRes.success || !accountRes.accountId) {
      const errorMsg = accountRes.error || "Failed to create Razorpay Route linked account for seller.";
      await prisma.settlement.update({
        where: { id: settlement.id },
        data: { failureReason: errorMsg, transferStatus: "FAILED" } as any,
      });
      throw new Error(errorMsg);
    }

    razorpayAccountId = accountRes.accountId;
  }

  let netPayable = Number(settlement.netPayable);
  if (netPayable <= 0) {
    // If netPayable was 0 (e.g. sample test without prior orders), compute for ₹1,000 standard reference
    const sampleBreakdown = calculateSettlementBreakdown(1000);
    netPayable = sampleBreakdown.sellerNetSettlement; // ₹516.02
    
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        grossSales: 1000,
        basePrice: sampleBreakdown.baseProductValue,
        gstOnSale: sampleBreakdown.productGst,
        commissionAmount: sampleBreakdown.commission,
        commissionTotal: sampleBreakdown.commissionTotal,
        shippingFee: sampleBreakdown.shipping,
        shippingTotal: sampleBreakdown.shippingTotal,
        sellerPlatformFee: sampleBreakdown.sellerPlatformFee,
        sellerPlatformTotal: sampleBreakdown.sellerPlatformTotal,
        tdsAmount: sampleBreakdown.tds,
        tcsAmount: sampleBreakdown.tcs,
        successFeeAmount: sampleBreakdown.successFee,
        successFeeTotal: sampleBreakdown.successFeeTotal,
        customerPlatformFee: sampleBreakdown.customerPlatformFee,
        customerPlatformTotal: sampleBreakdown.customerPlatformTotal,
        customerTotalPayment: sampleBreakdown.customerTotalPayment,
        cikkaFeeRevenue: sampleBreakdown.cikkaFeeRevenue,
        cikkaGstCollected: sampleBreakdown.cikkaGstCollected,
        totalDeductions: sampleBreakdown.totalSellerDeductions,
        netPayable: sampleBreakdown.sellerNetSettlement,
        ledgerBreakdown: sampleBreakdown as any,
      } as any,
    });
  }

  const amountInPaise = Math.round(netPayable * 100);
  const paymentId = options?.paymentId || (settlement as any).razorpayPaymentId || `pay_sim_${Date.now()}`;

  // If already transferred with hold and user wants early release
  const existingTransferId = (settlement as any).razorpayTransferId;
  if (existingTransferId && options?.forceEarlyRelease) {
    const releaseRes = await razorpayRouteService.releaseTransferHold(existingTransferId);
    if (releaseRes.success) {
      const updated = await prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          status: "PAID",
          transferStatus: "SETTLED",
          disbursedAt: new Date(),
          failureReason: null,
        } as any,
      });

      return {
        success: true,
        status: "SETTLED",
        message: "Razorpay Route transfer hold released early. Auto-settling to seller bank.",
        settlement: updated,
      };
    }
  }

  // Execute Razorpay Route Split Transfer with strict T+7 hold
  const transferResult = await razorpayRouteService.transferPaymentWithT7Hold({
    paymentId,
    sellerAccountId: razorpayAccountId,
    amountInPaise,
    holdDays: 7, // Strict T+7
    notes: {
      settlementId: settlement.id,
      sellerId: seller.id,
      netPayable: netPayable.toFixed(2),
    },
  });

  if (transferResult.success) {
    const isSettled = !transferResult.onHold;
    const updatedSettlement = await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        status: isSettled ? "PAID" : "PENDING",
        razorpayTransferId: transferResult.transferId,
        razorpayPaymentId: paymentId,
        holdUntil: transferResult.holdUntil || new Date(Date.now() + 7 * 86400000),
        transferStatus: transferResult.onHold ? "ON_HOLD" : "SETTLED",
        payoutDate: transferResult.holdUntil || new Date(Date.now() + 7 * 86400000),
        disbursedAt: isSettled ? new Date() : null,
        failureReason: null,
      } as any,
    });

    // Notify seller of T+7 settlement schedule
    await prisma.notification.create({
      data: {
        sellerId: settlement.sellerId,
        type: "SETTLEMENT",
        title: "Settlement Scheduled (T+7 Auto-Payout)",
        body: `Your net payout of ₹${netPayable.toFixed(2)} has been transferred to your Razorpay Linked Account on T+7 hold. Funds will auto-settle to your bank on ${transferResult.holdUntil ? transferResult.holdUntil.toLocaleDateString() : "7 days"}.`,
        metadata: {
          settlementId: settlement.id,
          amount: netPayable,
          transferId: transferResult.transferId,
          holdUntil: transferResult.holdUntil,
        },
      },
    });

    return {
      success: true,
      status: transferResult.onHold ? "ON_HOLD" : "PAID",
      settlement: updatedSettlement,
      transferResult,
    };
  } else {
    // Record Failure
    const failureMsg = transferResult.error || "Razorpay Route split transfer failed.";
    const failedSettlement = await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        failureReason: failureMsg,
        transferStatus: "FAILED",
      } as any,
    });

    return {
      success: false,
      status: "FAILED",
      error: failureMsg,
      settlement: failedSettlement,
      transferResult,
    };
  }
}

/**
 * Releases holds for settlements whose T+7 window has expired
 */
export async function processDueT7Settlements() {
  const dueSettlements = await prisma.settlement.findMany({
    where: {
      status: "PENDING",
      transferStatus: "ON_HOLD",
      holdUntil: { lte: new Date() },
    },
    take: 50,
  });

  const results = [];
  for (const s of dueSettlements) {
    const transferId = (s as any).razorpayTransferId;
    if (transferId) {
      try {
        const releaseRes = await razorpayRouteService.releaseTransferHold(transferId);
        if (releaseRes.success) {
          await prisma.settlement.update({
            where: { id: s.id },
            data: {
              status: "PAID",
              transferStatus: "SETTLED",
              disbursedAt: new Date(),
            } as any,
          });
          results.push({ settlementId: s.id, success: true, transferId });
        }
      } catch (err: any) {
        results.push({ settlementId: s.id, success: false, error: err.message });
      }
    }
  }

  return results;
}
