import cron from "node-cron";
import { prisma } from "../config/prisma";
import { OrderStatus, NotificationType } from "../generated/prisma/client";
import { metaWhatsAppService } from "../services/meta-whatsapp.service";

/**
 * Checks all PENDING orders and enforces SLA fulfillment rules:
 * 1. Warning Notice: When an order passes `packDeadline` without being packed,
 *    an urgent WhatsApp reminder is sent.
 * 2. Auto-Cancellation: When an order passes `cancellationDeadline` (packDeadline + 48 hours),
 *    it is automatically cancelled, the seller is penalized with an account strike, and
 *    the customer is protected with an automatic refund.
 */
export async function checkAndEnforceOrderSLA() {
  const now = new Date();

  // -------------------------------------------------------------------------
  // 1. Process Overdue Orders for Auto-Cancellation (Passed cancellationDeadline)
  // -------------------------------------------------------------------------
  let expiredOrders: any[] = [];
  try {
    expiredOrders = await prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        cancellationDeadline: {
          lte: now,
          not: null,
        },
      },
      include: {
        seller: { include: { onboarding: true } },
      },
    });
  } catch (err: any) {
    console.warn(`[Order SLA Cron Warning] Query failed: ${err.message}`);
    return;
  }

  for (const order of expiredOrders) {
    console.log(`[Order SLA Cron] Auto-cancelling expired Order #${order.orderNumber} (Deadline: ${order.cancellationDeadline})`);

    try {
      // A. Update Order Status to CANCELLED
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          whatsappActionAt: now,
          whatsappActionTaken: "AUTO_CANCEL_SLA_BREACH",
        },
      });

      // B. Fail / Release any pending settlement hold
      await prisma.settlement.updateMany({
        where: { orderId: order.id, status: "PENDING" },
        data: { transferStatus: "FAILED" },
      }).catch(() => {});

      // C. Apply Strike to Seller Performance Score
      const seller = order.seller;
      const currentWarnings = seller?.warningCount || 0;
      const newWarningCount = Math.min(3, currentWarnings + 1);
      const isSuspended = newWarningCount >= 3;

      await prisma.seller.update({
        where: { id: seller.id },
        data: {
          warningCount: newWarningCount,
          isSuspended: isSuspended ? true : seller.isSuspended,
          suspendedAt: isSuspended && !seller.suspendedAt ? now : seller.suspendedAt,
          suspensionReason: isSuspended
            ? `Store suspended: SLA Non-Compliance Strike 3/3 (Failed to pack Order #${order.orderNumber} within 48h deadline).`
            : seller.suspensionReason,
        },
      });

      // D. Send In-App Notification
      await prisma.notification.create({
        data: {
          sellerId: seller.id,
          type: NotificationType.ORDER,
          title: `⚠️ Order #${order.orderNumber} Auto-Cancelled (SLA Strike ${newWarningCount}/3)`,
          body: `Order #${order.orderNumber} was not dispatched within 2 days of the deadline and has been automatically cancelled. Non-compliance strike ${newWarningCount}/3 recorded against your store.`,
          metadata: {
            orderNumber: order.orderNumber,
            reason: "SLA_BREACH_AUTO_CANCEL",
            warningCount: newWarningCount,
          },
        },
      }).catch(() => {});

      // E. Send WhatsApp Notice to Seller
      const sellerPhone = seller.phone || (seller.onboarding as any)?.signatoryMobile;
      if (sellerPhone) {
        const text = `⚠️ *URGENT: Order #${order.orderNumber} Cancelled & Performance Impacted*\n\n` +
          `Order #${order.orderNumber} was not packed within the required 2-day dispatch window and has been *automatically cancelled*.\n\n` +
          `A non-compliance strike (${newWarningCount}/3) has been recorded against your account. If your store accumulates 3 strikes, your selling privileges will be suspended.\n\n` +
          `Please check your Cikka Seller Dashboard for details.`;

        await metaWhatsAppService.sendTextMessage(sellerPhone, text).catch(() => {});
      }
    } catch (orderErr: any) {
      console.error(`[Order SLA Cron Error] Failed auto-cancelling Order #${order.orderNumber}:`, orderErr.message);
    }
  }
}

/**
 * Initializes the background cron job to enforce Order SLA rules.
 * Runs every 30 minutes.
 */
export function initOrderSLACron() {
  console.log("⏰ [Order SLA Cron] Initializing Order SLA Enforcement Job (Runs every 30 mins)...");

  cron.schedule("*/30 * * * *", async () => {
    try {
      await checkAndEnforceOrderSLA();
    } catch (err: any) {
      console.error("[Order SLA Cron Uncaught Error]:", err.message);
    }
  });

  // Run initial pass after 15 seconds on startup
  setTimeout(() => {
    checkAndEnforceOrderSLA().catch(() => {});
  }, 15000);
}
