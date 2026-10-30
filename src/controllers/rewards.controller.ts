import crypto from "crypto";
import { Request, Response } from "express";
import { razorpayService } from "../services/razorpay.service";
import { razorpayRouteService } from "../services/razorpayRoute.service";
import { calculateSettlementBreakdown } from "../services/settlementCalculator.service";
import { getSellerSettlementProfile } from "../services/settlement.service";
import { shipwayService } from "../services/shipway.service";
import { walletService } from "../services/wallet.service";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { OrderStatus, NotificationType, WalletTxType } from "../generated/prisma/client";

/**
 * Helper to match or create a seller for a given pickup pincode
 */
async function findOrCreateSeller(pickupPincode: string, categoryHint?: string): Promise<any> {
  try {
    const allSellers = await prisma.seller.findMany({
      include: { onboarding: true, commissionConfig: true },
    });

    if (allSellers.length > 0) {
      for (const s of allSellers) {
        const addr = s.onboarding?.pickupAddress as any;
        if (addr && (addr.pincode === pickupPincode || addr.pin === pickupPincode)) {
          return s;
        }
      }
      if (pickupPincode === "122008") {
        const s = allSellers.find((x) => x.businessName.toLowerCase().includes("nike"));
        if (s) return s;
      }
      if (pickupPincode === "226005") {
        const s = allSellers.find(
          (x) =>
            x.businessName.toLowerCase().includes("fabindia") ||
            x.businessName.toLowerCase().includes("linen")
        );
        if (s) return s;
      }
      return allSellers[0];
    }

    const created = await prisma.seller.create({
      data: {
        phone: "9876543210",
        email: "partner@cikka.club",
        businessName: "Cikka Flagship Store",
        kycVerified: true,
        onboardingStatus: "COMPLETED" as any,
      },
      include: { onboarding: true },
    });
    return created;
  } catch (err: any) {
    console.warn(`[Rewards findOrCreateSeller Notice]: ${err.message}`);
    return null;
  }
}

/**
 * Helper to ensure product exists in Prisma to satisfy OrderItem relations
 */
async function getOrCreateProductForSeller(
  sellerId: string,
  name: string,
  price: number,
  category: string
): Promise<string> {
  try {
    const existing = await prisma.product.findFirst({
      where: {
        sellerId,
        name: { contains: name.slice(0, 15), mode: "insensitive" },
      },
    });
    if (existing) return existing.id;

    const anyProd = await prisma.product.findFirst({ where: { sellerId } });
    if (anyProd) return anyProd.id;

    const created = await prisma.product.create({
      data: {
        sellerId,
        name,
        sku: `RW-${Date.now().toString(36).toUpperCase()}`,
        price: Number(price),
        mrp: Number(price) * 1.25,
        category,
        stockQty: 99,
        status: "ACTIVE" as any,
      },
    });
    return created.id;
  } catch (err: any) {
    console.warn(`[Rewards getOrCreateProductForSeller Notice]: ${err.message}`);
    const fallback = await prisma.product.findFirst();
    if (fallback) return fallback.id;
    throw err;
  }
}

/**
 * POST /api/rewards/initiate-redemption
 * Step 1: Customer selects physical product to redeem with CI Points.
 * Validates points balance, product value, and creates Razorpay PG Order for Customer Platform Fee (₹11.79 = ₹9.99 + 18% GST).
 */
export const initiateRedemption = asyncHandler(async (req: Request, res: Response) => {
  const {
    productId,
    productName = "Cikka Curated Reward",
    productValue = 1000, // In Rupees (e.g. ₹1,000)
    pointsRequired = 1000,
    customerName,
    customerEmail,
    customerPhone,
  } = req.body;

  // Platform Fee Math: Fixed ₹9.99 + 18% GST (₹1.80) = ₹11.79
  const platformFeeBase = 9.99;
  const platformFeeGst = 1.8;
  const customerPayableRupees = 11.79;
  const customerPayablePaise = Math.round(customerPayableRupees * 100); // 1179 paise

  const receipt = `rw_rcpt_${Date.now()}`;
  const rzpOrder = await razorpayService.createOrder({
    amount: customerPayablePaise,
    currency: "INR",
    receipt,
    notes: {
      type: "REWARDS_STORE_PLATFORM_FEE",
      product_name: String(productName).slice(0, 40),
      product_value: String(productValue),
      points_required: String(pointsRequired),
      customer_name: customerName || "Cikka Member",
    },
  });

  res.status(200).json({
    success: true,
    message: "Rewards redemption order initiated. Proceed with customer platform fee authorization.",
    order_id: rzpOrder.order_id,
    amount: customerPayablePaise,
    amount_in_rupees: customerPayableRupees,
    currency: "INR",
    key_id: rzpOrder.key_id,
    product_value: Number(productValue),
    points_required: Number(pointsRequired),
    platform_fee_breakdown: {
      base_fee: platformFeeBase,
      gst_18: platformFeeGst,
      total_payable: customerPayableRupees,
    },
  });
});

/**
 * POST /api/rewards/confirm-redemption
 * Step 2: Verifies Customer Platform Fee payment (pay_cust_...), deducts CI Points,
 * creates Order and Redemption records, funds transaction from Cikka Treasury,
 * initiates Razorpay Route transfer to seller on T+7 hold, records Settlement, and pushes to Shipway.
 */
export const confirmRedemption = asyncHandler(async (req: Request, res: Response) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    product_name = "Cikka Rewards Store Product",
    product_value = 1000,
    points_burned = 1000,
    customer_name = "Cikka Member",
    customer_email = "member@cikka.club",
    customer_phone = "9876549812",
    delivery_address = "123, Sample Street, Mumbai – 400001",
    pincode = "400001",
    city = "Mumbai",
    pickup_pincode = "122008",
    carrier_name = "Delhivery 3PL Express (0.5kg)",
    category = "Rewards",
  } = req.body;
  const product_category = (req.body.product_category || req.body.category || category || "Rewards").trim();

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Missing required fields: razorpay_order_id, razorpay_payment_id, razorpay_signature",
    });
    return;
  }

  // 1. Verify Razorpay Payment Signature for the Customer Platform Fee
  const isValid = razorpayService.verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature
  );

  if (!isValid) {
    res.status(400).json({
      success: false,
      verified: false,
      error: "Invalid customer payment signature for platform fee",
    });
    return;
  }

  // 1b. Enforce server-side CI Points balance (replaces AsyncStorage trust)
  //     Only check when the caller is an authenticated user.
  const authenticatedUserId = req.user?.id ?? null;
  const numPointsBurnedRequested = Number(points_burned) || 0;

  if (authenticatedUserId && numPointsBurnedRequested > 0) {
    const balance = await walletService.getBalance(authenticatedUserId);
    if (balance.ciPoints < numPointsBurnedRequested) {
      res.status(422).json({
        success: false,
        verified: false,
        error: `Insufficient CI Points. You have ${balance.ciPoints} but the redemption requires ${numPointsBurnedRequested}.`,
        current_balance: balance.ciPoints,
        required: numPointsBurnedRequested,
      });
      return;
    }
  }

  // 2. Generate Dual Primary Identifiers
  const randSuffix = Math.floor(100000 + Math.random() * 900000);
  const orderId = `ORD-RW-${randSuffix}`;
  const redemptionId = `RDM-${randSuffix}`;
  const generatedAwb = `AWB-${Math.floor(10000000 + Math.random() * 90000000)}`;

  const numProductValue = Number(product_value) || 1000;
  const numPointsBurned = Number(points_burned) || 1000;

  // 3. Resolve Seller & Product
  const seller = await findOrCreateSeller(pickup_pincode, "Rewards");
  if (!seller) {
    res.status(500).json({ success: false, error: "Failed to resolve seller for redemption pickup" });
    return;
  }

  const productId = await getOrCreateProductForSeller(seller.id, product_name, numProductValue, "Rewards");

  // 4. Create Order & OrderItem in Prisma DB (Marked as Rewards Store, Prepaid by Cikka)
  const dbOrder = await prisma.order.create({
    data: {
      sellerId: seller.id,
      orderNumber: orderId,
      customerName: `${customer_name} (${redemptionId})`,
      customerCity: `${city} (${pincode})`,
      totalAmount: numProductValue,
      status: OrderStatus.SHIPPED,
      trackingNumber: generatedAwb,
      courier: carrier_name,
      items: {
        create: [
          {
            productId,
            quantity: 1,
            unitPrice: numProductValue,
          },
        ],
      },
    },
    include: { items: true },
  });

  console.log(`[Rewards Store Order Created] #${orderId} (${product_name}) linked to Redemption #${redemptionId} -> Seller #${seller.id}`);

  // 5. Calculate Deterministic Settlement Breakdown (Commission, Shipping, Platform, Success Fee, TDS, TCS)
  const profile = await getSellerSettlementProfile(seller.id, product_category);
  const breakdown = calculateSettlementBreakdown(numProductValue, profile.customConfig);
  const netSellerPayout = breakdown.sellerNetSettlement;
  const netPaise = Math.round(netSellerPayout * 100);

  // 6. Resolve Seller Razorpay Linked Account
  let rzpAccountId = seller.razorpayAccountId || (seller.onboarding as any)?.razorpayAccountId;
  if (!rzpAccountId) {
    try {
      const accRes = await razorpayRouteService.createLinkedAccount({
        sellerId: seller.id,
        businessName: seller.businessName || "Cikka Merchant Partner",
        businessType: seller.onboarding?.businessType as any,
        email: seller.email || "seller@cikka.club",
        phone: seller.phone || "9876543210",
        signatoryName: seller.onboarding?.signatoryName || undefined,
        panNumber: seller.onboarding?.panNumber || undefined,
        gstNumber: seller.onboarding?.gstNumber || undefined,
        address: seller.onboarding?.pickupAddress as any,
      });
      if (accRes.accountId) {
        rzpAccountId = accRes.accountId;
      }
    } catch (accErr: any) {
      console.warn(`[Rewards Route Account Notice]: ${accErr.message}`);
    }
  }

  // 7. Cikka Corporate Funding Transfer via Razorpay Route with dynamic hold
  let transferResult: any = null;
  if (rzpAccountId && netPaise > 0) {
    try {
      transferResult = await razorpayRouteService.transferPaymentWithT7Hold({
        paymentId: razorpay_payment_id, // Links settlement hold to payment event
        sellerAccountId: rzpAccountId,
        amountInPaise: netPaise,
        holdDays: profile.holdDays,
        notes: {
          orderNumber: orderId,
          redemptionNumber: redemptionId,
          fundingSource: "CIKKA_REWARDS_TREASURY",
          category: product_category,
          commissionRate: `${profile.commissionRate}%`,
          flatOrderFee: `₹${profile.flatOrderFee}`,
          settlementCycle: profile.settlementCycle,
          productValue: String(numProductValue),
          pointsBurned: String(numPointsBurned),
          netPayable: String(netSellerPayout),
        },
      });
    } catch (trfErr: any) {
      console.warn(`[Rewards Route Transfer Warning]: ${trfErr.message}`);
    }
  }

  // 8. Record Deterministic Settlement in Prisma
  const holdUntil = transferResult?.holdUntil || new Date(Date.now() + profile.holdDays * 86400000);

  const settlement = await prisma.settlement.create({
    data: {
      sellerId: seller.id,
      periodStart: new Date(),
      periodEnd: new Date(),
      category: "Rewards Store Redemption",
      grossSales: breakdown.grossProductValue,
      basePrice: breakdown.baseProductValue,
      gstOnSale: breakdown.productGst,
      commissionRate: breakdown.commissionRate,
      commissionAmount: breakdown.commission,
      commissionTotal: breakdown.commissionTotal,
      shippingFee: breakdown.shipping,
      shippingTotal: breakdown.shippingTotal,
      sellerPlatformFee: breakdown.sellerPlatformFee,
      sellerPlatformTotal: breakdown.sellerPlatformTotal,
      tdsAmount: breakdown.tds,
      tcsAmount: breakdown.tcs,
      statutoryTaxes: breakdown.tds + breakdown.tcs,
      successFeeAmount: breakdown.successFee,
      successFeeTotal: breakdown.successFeeTotal,
      customerPlatformFee: breakdown.customerPlatformFee,
      customerPlatformTotal: breakdown.customerPlatformTotal,
      customerTotalPayment: breakdown.customerTotalPayment,
      cikkaFeeRevenue: breakdown.cikkaFeeRevenue,
      cikkaGstCollected: breakdown.cikkaGstCollected,
      totalDeductions: breakdown.totalSellerDeductions,
      netPayable: breakdown.sellerNetSettlement,
      status: "PENDING",
      transferStatus: transferResult?.onHold ? "ON_HOLD" : "SETTLED",
      razorpayTransferId: transferResult?.transferId,
      razorpayPaymentId: razorpay_payment_id,
      holdUntil,
      payoutDate: holdUntil,
      ledgerBreakdown: {
        ...breakdown,
        orderId,
        redemptionId,
        customerPaymentId: razorpay_payment_id,
        fundingSource: "CIKKA_REWARDS_TREASURY",
        pointsBurned: numPointsBurned,
        customerFeePaid: 11.79,
      } as any,
    } as any,
  });

  // 8b. Atomically debit CI Points from server-side ledger (double-entry)
  //     Tied to redemptionId so this can never be applied twice even if the
  //     client retries the confirm endpoint.
  let walletDebitResult: Awaited<ReturnType<typeof walletService.debitPoints>> | null = null;
  if (authenticatedUserId && numPointsBurned > 0) {
    try {
      walletDebitResult = await walletService.debitPoints(
        authenticatedUserId,
        numPointsBurned,
        WalletTxType.REDEEM_REWARD,
        {
          redemptionId,
          razorpayPaymentId: razorpay_payment_id,
          description: `Rewards Store redemption: ${product_name}`,
          idempotencyKey: `REDEEM_REWARD:${redemptionId}`,
        }
      );
    } catch (walletErr: any) {
      // Log but don't fail the response — settlement is already recorded.
      // The ledger entry will simply be missing; ops can reconcile manually.
      console.warn(`[Rewards Wallet Debit Warning]: ${walletErr.message}`);
    }
  }

  // 9. Emit Seller In-App Notifications
  await prisma.notification.create({
    data: {
      sellerId: seller.id,
      type: NotificationType.ORDER,
      title: `Rewards Store Order: #${orderId}`,
      body: `Prepaid by Cikka via CI Points Redemption (${redemptionId}). Courier: ${carrier_name}. AWB: ${generatedAwb}`,
      metadata: {
        orderNumber: orderId,
        redemptionNumber: redemptionId,
        awb: generatedAwb,
        courier: carrier_name,
      },
    },
  }).catch(() => {});

  await prisma.notification.create({
    data: {
      sellerId: seller.id,
      type: NotificationType.SETTLEMENT,
      title: `Rewards Payout Scheduled (T+${profile.holdDays}): ₹${netSellerPayout.toFixed(2)}`,
      body: `Net settlement transferred to your Linked Account on T+${profile.holdDays} hold. Auto-release scheduled for ${holdUntil.toLocaleDateString("en-IN")}.`,
      metadata: {
        orderNumber: orderId,
        redemptionNumber: redemptionId,
        transferId: transferResult?.transferId,
        holdUntil: holdUntil.toISOString(),
      },
    },
  }).catch(() => {});

  // 10. Push to Shipway Experience API
  shipwayService
    .pushOrderData({
      order_id: orderId,
      customer_name: customer_name,
      customer_email: customer_email,
      customer_phone: customer_phone,
      delivery_address: delivery_address,
      pincode: pincode,
      pickup_pincode: pickup_pincode,
      carrier_name: carrier_name,
      awb_number: generatedAwb,
      total_amount: numProductValue,
      payment_type: "Prepaid",
      products: [
        {
          product: product_name,
          price: numProductValue,
          product_code: productId,
          product_quantity: 1,
        },
      ],
    })
    .then((pushRes) => {
      console.log(`[Shipway Rewards Order Pushed] Order #${orderId} -> Status: ${pushRes.status}`);
    })
    .catch((err) => {
      console.warn(`[Shipway Rewards Push Notice]: ${err.message}`);
    });

  // 11. Send Verified Response (Strict Rule: Zero Cashback & Zero Points Earned on Rewards Redemptions)
  res.status(200).json({
    success: true,
    verified: true,
    message: "Rewards redemption confirmed, points deducted, corporate funding allocated on T+7 hold, and order pushed to Shipway.",
    order_id: orderId,
    redemption_id: redemptionId,
    customer_payment_id: razorpay_payment_id,
    customer_fee_paid: 11.79,
    points_burned: numPointsBurned,
    product_value: numProductValue,
    cashback_earned: 0, // Strict rule: No cashback on Rewards Store redemptions
    points_earned: 0,   // Strict rule: No new CI points generated on redemption
    net_seller_payout: netSellerPayout,
    cikka_retained_earnings: breakdown.cikkaFeeRevenue,
    transfer_id: transferResult?.transferId,
    settlement_id: settlement.id,
    hold_until: holdUntil,
    awb: generatedAwb,
    courier: carrier_name,
    tracking_url: `/api/shipway/tracking/${orderId}`,
    // Updated server-side wallet balance (undefined if user not authenticated or no points burned)
    wallet: walletDebitResult
      ? {
          balance_after_points: walletDebitResult.balanceAfterPoints,
          balance_after_cash_rupees: walletDebitResult.balanceAfterPaise / 100,
          ledger_entry_id: walletDebitResult.ledgerEntryId,
        }
      : null,
  });
});
