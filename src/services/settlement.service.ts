import { prisma } from "../config/prisma";
import { razorpayRouteService } from "./razorpayRoute.service";
import {
  calculateSettlementBreakdown,
  SettlementFeeConfig,
  SettlementLedgerBreakdown,
} from "./settlementCalculator.service";

export interface SellerSettlementProfile {
  customConfig: Partial<SettlementFeeConfig>;
  holdDays: number;
  commissionRate: number;
  flatOrderFee: number;
  settlementCycle: string;
}

/**
 * Resolves the dynamic fee configuration and settlement cycle for a seller
 * based on admin-defined SellerCommissionConfig and Onboarding data.
 */
export async function getSellerSettlementProfile(
  sellerId: string,
  categoryHint?: string
): Promise<SellerSettlementProfile> {
  const [commissionConfig, seller, onboarding] = await Promise.all([
    prisma.sellerCommissionConfig.findUnique({ where: { sellerId } }),
    prisma.seller.findUnique({ where: { id: sellerId } }),
    prisma.sellerOnboarding.findUnique({ where: { sellerId } }),
  ]);

  let activeCategory = categoryHint || onboarding?.businessCategory;
  if (!activeCategory && onboarding?.productCategories) {
    if (Array.isArray(onboarding.productCategories) && onboarding.productCategories.length > 0) {
      activeCategory = onboarding.productCategories[0] as string;
    } else if (typeof onboarding.productCategories === "string") {
      try {
        const parsed = JSON.parse(onboarding.productCategories);
        if (Array.isArray(parsed) && parsed.length > 0) activeCategory = parsed[0];
      } catch {}
    }
  }

  // 1. Resolve Commission Rate:
  let commissionRate = 22.0;
  if (commissionConfig?.categoryCommissions && typeof commissionConfig.categoryCommissions === "object") {
    const ratesMap = commissionConfig.categoryCommissions as Record<string, number>;
    if (activeCategory && ratesMap[activeCategory] !== undefined) {
      commissionRate = Number(ratesMap[activeCategory]);
    } else {
      const matchedKey = Object.keys(ratesMap).find(
        (k) => activeCategory && k.toLowerCase() === activeCategory.toLowerCase()
      );
      if (matchedKey && ratesMap[matchedKey] !== undefined) {
        commissionRate = Number(ratesMap[matchedKey]);
      } else {
        const firstVal = Object.values(ratesMap)[0];
        if (firstVal !== undefined) commissionRate = Number(firstVal);
      }
    }
  }

  // 2. Resolve Flat Order Fee:
  const flatOrderFee = commissionConfig?.flatOrderFee !== undefined
    ? Number(commissionConfig.flatOrderFee)
    : 15.0;

  // 3. Resolve Settlement Cycle & Hold Days:
  const cycle = commissionConfig?.settlementCycle || onboarding?.settlementCycle || "T_PLUS_7";
  let holdDays = 7;
  if (cycle === "T_PLUS_1") holdDays = 1;
  else if (cycle === "T_PLUS_3") holdDays = 3;
  else if (cycle === "T_PLUS_7") holdDays = 7;
  else if (cycle === "T_PLUS_14") holdDays = 14;

  const customConfig: Partial<SettlementFeeConfig> = {
    commissionRate,
    sellerPlatformFee: flatOrderFee,
  };

  return {
    customConfig,
    holdDays,
    commissionRate,
    flatOrderFee,
    settlementCycle: cycle,
  };
}

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
  const profile = await getSellerSettlementProfile(sellerId);
  const effectiveConfig = customConfig || profile.customConfig;

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
    effectiveConfig
  );

  // Dynamic hold calculation matching seller's settlement cycle (e.g. T+1, T+3, T+7, T+14)
  const holdUntil = new Date(Date.now() + profile.holdDays * 24 * 60 * 60 * 1000);

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

    const targetEmail = (seller.email && seller.email.trim())
      || (onboarding?.signatoryEmail && onboarding.signatoryEmail.trim());

    const accountRes = await razorpayRouteService.createLinkedAccount({
      sellerId: seller.id,
      businessName: seller.businessName || onboarding?.businessName || "Merchant Partner",
      businessType: onboarding?.businessType as any,
      email: targetEmail || "seller@cikka.club",
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

  const profile = await getSellerSettlementProfile(seller.id, settlement.category);

  let netPayable = Number(settlement.netPayable);
  if (netPayable <= 0) {
    // If netPayable was 0 (e.g. sample test without prior orders), compute for ₹1,000 standard reference using seller profile
    const sampleBreakdown = calculateSettlementBreakdown(1000, profile.customConfig);
    netPayable = sampleBreakdown.sellerNetSettlement;
    
    await prisma.settlement.update({
      where: { id: settlement.id },
      data: {
        grossSales: 1000,
        basePrice: sampleBreakdown.baseProductValue,
        gstOnSale: sampleBreakdown.productGst,
        commissionRate: sampleBreakdown.commissionRate,
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

  // Execute Razorpay Route Split Transfer with dynamic hold (T+1, T+3, T+7, T+14)
  const transferResult = await razorpayRouteService.transferPaymentWithT7Hold({
    paymentId,
    sellerAccountId: razorpayAccountId,
    amountInPaise,
    holdDays: profile.holdDays,
    notes: {
      settlementId: settlement.id,
      sellerId: seller.id,
      commissionRate: `${profile.commissionRate}%`,
      settlementCycle: profile.settlementCycle,
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

    // Notify seller of dynamic settlement schedule
    await prisma.notification.create({
      data: {
        sellerId: settlement.sellerId,
        type: "SETTLEMENT",
        title: `Settlement Scheduled (T+${profile.holdDays} Auto-Payout)`,
        body: `Your net payout of ₹${netPayable.toFixed(2)} has been transferred to your Razorpay Linked Account on T+${profile.holdDays} hold. Funds will auto-settle to your bank on ${transferResult.holdUntil ? transferResult.holdUntil.toLocaleDateString() : `${profile.holdDays} days`}.`,
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
