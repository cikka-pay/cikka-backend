import cron from "node-cron";
import { prisma } from "../config/prisma";
import { NotificationType } from "../generated/prisma/client";
import { sendResendMail } from "../utils/resend";

/**
 * Checks all pending return requests (status === 'REQUESTED')
 * and enforces the 24-hour Return SLA:
 * - Every 3 hours (up to 8 times = 24 hrs): Sends dashboard & WhatsApp reminder.
 * - Stops immediately once seller Approves or Rejects.
 * - After 24 hours without action: Issues formal 3rd Notice of Account Suspension via Email (Resend) and Dashboard Warning.
 */
export async function checkAndEnforceReturnSLA() {
  const pendingReturns = await prisma.return.findMany({
    where: { status: "REQUESTED" },
    include: {
      order: {
        include: {
          seller: { include: { onboarding: true } },
        },
      },
      product: true,
    },
  });

  if (pendingReturns.length === 0) return;

  const now = Date.now();

  for (const ret of pendingReturns) {
    const createdTime = new Date(ret.createdAt).getTime();
    const elapsedHours = (now - createdTime) / (1000 * 60 * 60);

    // If within the first 3 hours, no reminder is needed yet
    if (elapsedHours < 3) continue;

    // Target cycle: 1 to 8 (every 3 hours)
    const targetCycle = Math.min(8, Math.floor(elapsedHours / 3));

    // Fetch existing SLA alerts for this return
    const sellerNotifications = await prisma.notification.findMany({
      where: { sellerId: ret.order.sellerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const returnAlerts = sellerNotifications.filter(
      (n: any) => n.metadata && (n.metadata as any).returnId === ret.id
    );

    const sentCycles = new Set<number>(
      returnAlerts
        .map((a: any) => (a.metadata as any)?.reminderCycle)
        .filter((c: any) => typeof c === "number")
    );

    const suspensionNoticeSent = returnAlerts.some(
      (a: any) => (a.metadata as any)?.isSuspensionWarning === true
    );

    // =========================================================================
    // 1. RE-NOTIFICATION: Every 3 hours (Cycles 1 through 8 = 24 hrs total)
    // =========================================================================
    if (!sentCycles.has(targetCycle) && targetCycle >= 1 && targetCycle <= 8) {
      // A. Dashboard In-App Notification
      await prisma.notification.create({
        data: {
          sellerId: ret.order.sellerId,
          type: NotificationType.ORDER,
          title: `⚠️ Action Required: Return Request Pending (${targetCycle}/8)`,
          body: `Reminder ${targetCycle} of 8: Return request for Order #${ret.order.orderNumber} (${ret.product.name}) has been awaiting your decision for ${Math.floor(elapsedHours)} hours. Please Approve or Reject in your Dashboard.`,
          metadata: {
            returnId: ret.id,
            orderId: ret.order.id,
            orderNumber: ret.order.orderNumber,
            reminderCycle: targetCycle,
            type: "RETURN_SLA_REMINDER",
          },
        },
      });

      // B. WhatsApp Notification Dispatch
      const sellerPhone =
        ret.order.seller.phone || (ret.order.seller.onboarding as any)?.signatoryMobile || "9876543210";
      console.log(
        `📱 [WhatsApp Notification Sent] +91${sellerPhone}: "Action Required: Return Request for Order #${ret.order.orderNumber} is pending your decision (Reminder ${targetCycle}/8). Please Approve or Reject in your Cikka Seller Dashboard."`
      );
    }

    // =========================================================================
    // 2. AFTER 24 HOURS (8 Reminders Exhausted): Progressive Strike (1/3, 2/3, 3/3 Final)
    // =========================================================================
    if (elapsedHours >= 24 && !suspensionNoticeSent) {
      const seller = await prisma.seller.findUnique({
        where: { id: ret.order.sellerId },
      });

      const currentWarnings = seller?.warningCount || 0;
      const newWarningCount = Math.min(3, currentWarnings + 1);
      const isFinalSuspension = newWarningCount >= 3;

      // Update seller's persistent strike counter & suspension state
      await prisma.seller.update({
        where: { id: ret.order.sellerId },
        data: {
          warningCount: newWarningCount,
          isSuspended: isFinalSuspension,
          suspendedAt: isFinalSuspension ? new Date() : seller?.suspendedAt,
          suspensionReason: isFinalSuspension
            ? `Store suspended automatically: Accumulated 3/3 Return SLA violation strikes (Latest: Order #${ret.order.orderNumber}).`
            : seller?.suspensionReason,
        },
      });

      const sellerEmail =
        seller?.email || (ret.order.seller.onboarding as any)?.signatoryEmail;
      const sellerName =
        seller?.businessName ||
        (ret.order.seller.onboarding as any)?.businessName ||
        "Seller Partner";

      // ── Configure Progressive Warning Copy based on Strike Level ──────────
      let strikeTitle = "";
      let strikeBody = "";
      let emailSubject = "";
      let badgeLabel = "";
      let badgeBg = "#f59e0b"; // Default Amber
      let penaltyListHtml = "";
      let headlineText = "";

      if (newWarningCount === 1) {
        strikeTitle = `⚠️ RETURN SLA STRIKE (Warning 1/3): Order #${ret.order.orderNumber}`;
        strikeBody = `NON-COMPLIANCE STRIKE 1/3: You did not approve or reject the Return Request for Order #${ret.order.orderNumber} within 24 hours. This has been recorded as Warning 1 of 3 against your seller account. If you accumulate 2/3 and 3/3 warnings, your account will be suspended. Please resolve this return request immediately.`;
        emailSubject = `⚠️ Warning 1/3: Return SLA Non-Compliance Strike - Order #${ret.order.orderNumber}`;
        badgeLabel = "WARNING 1 OF 3 (FIRST STRIKE)";
        badgeBg = "#f59e0b"; // Amber
        headlineText = "First Return SLA Strike Recorded (1/3)";
        penaltyListHtml = `
          <li>Record of Warning 1/3 logged in your Cikka Merchant compliance file.</li>
          <li>Subsequent non-compliance on another order will escalate to Warning 2/3.</li>
          <li>Reaching Warning 3/3 will trigger immediate store suspension and escrow release freezes.</li>
        `;
      } else if (newWarningCount === 2) {
        strikeTitle = `🚨 ESCALATED SLA STRIKE (Warning 2/3): Order #${ret.order.orderNumber}`;
        strikeBody = `CRITICAL STRIKE 2/3: You have incurred a 2nd SLA violation for failing to respond to Order #${ret.order.orderNumber} within 24 hours. Your store now has 2 of 3 maximum allowable strikes. One more violation (3/3) will immediately trigger store suspension and payout freezing.`;
        emailSubject = `🚨 URGENT: Warning 2/3 - Escalated Account Strike - Order #${ret.order.orderNumber}`;
        badgeLabel = "WARNING 2 OF 3 (HIGH RISK)";
        badgeBg = "#ea580c"; // Orange / Red
        headlineText = "Urgent: Second Return SLA Strike (2/3)";
        penaltyListHtml = `
          <li>Your store is now placed on high-risk compliance status (2 of 3 strikes).</li>
          <li>Only ONE remaining strike is permitted before automatic store closure.</li>
          <li>Any subsequent SLA violation (3/3 Final) will immediately freeze payouts and deactivate product listings.</li>
        `;
      } else {
        strikeTitle = `🛑 ACCOUNT SUSPENDED: Warning 3/3 (Final Strike Reached)`;
        strikeBody = `FINAL NOTICE (3/3): Your seller account has been SUSPENDED following 3 return SLA violations (latest: Order #${ret.order.orderNumber}). All product listings and escrow payouts are frozen under the Cikka Seller Agreement. Contact merchant support immediately.`;
        emailSubject = `🛑 CRITICAL: Account Suspension Enacted (Warning 3/3 Final) - Order #${ret.order.orderNumber}`;
        badgeLabel = "WARNING 3 OF 3 (FINAL SUSPENSION)";
        badgeBg = "#dc2626"; // Crimson Red
        headlineText = "Seller Account Suspended (3/3 Final Strike)";
        penaltyListHtml = `
          <li>Immediate suspension of your seller store and public product listings.</li>
          <li>Total freeze on pending payouts, transfers, and escrow disbursements.</li>
          <li>Automatic customer return approval and refund from your account balance.</li>
          <li>Formal account termination review initiated by Cikka Trust & Safety.</li>
        `;
      }

      // A. Dashboard High-Priority Notification
      await prisma.notification.create({
        data: {
          sellerId: ret.order.sellerId,
          type: NotificationType.SYSTEM,
          title: strikeTitle,
          body: strikeBody,
          metadata: {
            returnId: ret.id,
            orderId: ret.order.id,
            orderNumber: ret.order.orderNumber,
            isSuspensionWarning: true,
            warningCount: newWarningCount,
            strikeRatio: `${newWarningCount}/3`,
            isFinalSuspension,
            escalationLevel: `STRIKE_${newWarningCount}_OF_3`,
          },
        },
      });

      // B. Official Resend Email Notice
      if (sellerEmail && sellerEmail.includes("@")) {
        try {
          await sendResendMail({
            to: sellerEmail,
            subject: emailSubject,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid ${badgeBg}33; border-radius: 12px; background: #fffaf0;">
                <div style="background: ${badgeBg}; color: white; padding: 8px 16px; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 12px; margin-bottom: 16px;">
                  ${badgeLabel}
                </div>
                <h2 style="color: #1f2937; margin-top: 0; font-size: 20px;">${headlineText}</h2>
                <p style="color: #374151;">Dear <strong>${sellerName}</strong>,</p>
                <p style="color: #374151; line-height: 1.6;">
                  This is an official notice regarding compliance with the Cikka 24-Hour Return Resolution SLA.
                </p>
                <p style="color: #374151; line-height: 1.6;">
                  A customer return request was submitted for <strong>Order #${ret.order.orderNumber}</strong> (${ret.product.name}) over <strong>24 hours ago</strong>. Despite 8 prior reminders dispatched every 3 hours to your Seller Dashboard and WhatsApp, you did not select an option (Approve or Reject).
                </p>
                <div style="background: #ffffff; border-left: 4px solid ${badgeBg}; padding: 16px; margin: 20px 0; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                  <p style="margin: 0; font-weight: bold; color: #1f2937; font-size: 14px;">Strike Escalation Status: <strong>${newWarningCount} / 3 Strikes</strong></p>
                  <ul style="margin: 10px 0 0; color: #4b5563; padding-left: 20px; font-size: 13px; line-height: 1.6;">
                    ${penaltyListHtml}
                  </ul>
                </div>
                <p style="color: #374151; line-height: 1.6;">
                  ${
                    isFinalSuspension
                      ? "Because your store has reached 3/3 strikes, your selling privileges have been temporarily frozen. Please contact merchant support to appeal or resolve outstanding disputes."
                      : "Please log in to your <strong>Cikka Seller Dashboard</strong> immediately to take action on this pending return and avoid strike escalation."
                  }
                </p>
                <hr style="border: none; border-top: 1px solid #fed7aa; margin: 24px 0;" />
                <p style="color: #9ca3af; font-size: 11px; margin: 0;">
                  Cikka Trust & Safety &bull; Merchant Operations Team &bull; Support: merchant-support@cikka.club
                </p>
              </div>
            `,
            templateName: `seller_strike_${newWarningCount}_warning`,
          });
          console.log(`[Resend SLA Alert] Strike Notice (${newWarningCount}/3) dispatched to ${sellerEmail}`);
        } catch (mailErr: any) {
          console.warn("[Resend SLA Notice Warning]:", mailErr.message);
        }
      }
    }
  }
}

/**
 * VICE-VERSA HANDLER: Decrement a seller's warning count
 * Can be called when a seller improves compliance, resolves pending return issues,
 * or when an admin forgives / resets a strike (e.g. from 2/3 down to 1/3, or 1/3 down to 0/3).
 * If the seller was suspended (3/3), decrementing automatically reinstates the store (isSuspended: false).
 */
export async function decrementSellerWarning(sellerId: string, reason?: string) {
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
  });

  if (!seller) return null;

  const currentWarnings = seller.warningCount || 0;
  if (currentWarnings <= 0) return seller;

  const newCount = Math.max(0, currentWarnings - 1);
  const wasSuspended = seller.isSuspended;
  const isReinstated = wasSuspended && newCount < 3;

  const updatedSeller = await prisma.seller.update({
    where: { id: sellerId },
    data: {
      warningCount: newCount,
      isSuspended: newCount >= 3,
      suspendedAt: newCount >= 3 ? seller.suspendedAt : null,
      suspensionReason: newCount >= 3 ? seller.suspensionReason : null,
    },
  });

  // Notify seller of strike reduction / reinstatement
  await prisma.notification.create({
    data: {
      sellerId,
      type: NotificationType.SYSTEM,
      title: isReinstated
        ? `✅ Account Reinstated: Strike Decremented (${newCount}/3)`
        : `✅ SLA Strike Reduced: Current Status (${newCount}/3)`,
      body: `Good news! Your return SLA warning strike count has been reduced from ${currentWarnings}/3 to ${newCount}/3.${
        reason ? ` Reason: ${reason}.` : ""
      }${isReinstated ? " Your selling privileges and dashboard payouts have been restored." : ""}`,
      metadata: {
        previousCount: currentWarnings,
        newCount,
        reinstated: isReinstated,
        type: "STRIKE_DECREMENTED",
      },
    },
  }).catch(() => {});

  return updatedSeller;
}

/**
 * VICE-VERSA HANDLER: Reset all strikes back to 0/3 clean standing
 */
export async function resetSellerWarnings(sellerId: string, reason?: string) {
  const updatedSeller = await prisma.seller.update({
    where: { id: sellerId },
    data: {
      warningCount: 0,
      isSuspended: false,
      suspendedAt: null,
      suspensionReason: null,
    },
  });

  await prisma.notification.create({
    data: {
      sellerId,
      type: NotificationType.SYSTEM,
      title: `🌟 SLA Compliance Reset: 0/3 Clean Standing`,
      body: `All previous return SLA warnings have been cleared. Your store is now in full good standing (0 of 3 strikes).${
        reason ? ` Reason: ${reason}.` : ""
      }`,
      metadata: {
        warningCount: 0,
        reinstated: true,
        type: "STRIKES_CLEARED",
      },
    },
  }).catch(() => {});

  return updatedSeller;
}

/**
 * Initializes the Return SLA Monitor Cron Job
 * Runs every 15 minutes to check for elapsed 3-hour milestones and the 24-hour suspension mark.
 */
export function initReturnSLACron() {
  console.log("⏱️  [Return SLA Cron] Initializing 3-hour return escalation & 24-hour suspension monitor...");

  // Runs every 15 minutes to check milestones
  const task = cron.schedule("*/15 * * * *", async () => {
    try {
      await checkAndEnforceReturnSLA();
    } catch (err: any) {
      console.error("[Return SLA Cron Error]:", err.message || err);
    }
  });

  return task;
}
