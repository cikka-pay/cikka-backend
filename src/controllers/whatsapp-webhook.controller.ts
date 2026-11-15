import crypto from "crypto";
import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { OrderStatus, NotificationType } from "../generated/prisma/client";
import { shipwayService } from "../services/shipway.service";
import { metaWhatsAppService } from "../services/meta-whatsapp.service";
import { config } from "../config/env";

/**
 * Normalizes an Indian phone number to digits only (e.g. 919876543210 or 9876543210).
 */
function normalizeDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

function lastTenDigits(phone: string): string {
  return normalizeDigits(phone).slice(-10);
}

/** Constant-time check of Meta's `X-Hub-Signature-256: sha256=<hex>` header. */
function isValidMetaSignature(rawBody: string, header: unknown, appSecret: string): boolean {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice("sha256=".length), "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Extracts phone, action payload, and text from incoming Meta WhatsApp Cloud API webhook payload.
 */
function extractWebhookEvent(body: any): { senderPhone: string; actionPayload: string; buttonText: string } | null {
  if (!body) return null;

  // 1. Meta WhatsApp Cloud API format (entry[0].changes[0].value.messages[0])
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (message) {
    const senderPhone = normalizeDigits(String(message.from || ""));
    const actionPayload = message.button?.payload || message.interactive?.button_reply?.id || "";
    const buttonText = message.button?.text || message.interactive?.button_reply?.title || message.text?.body || "";

    return {
      senderPhone,
      actionPayload: String(actionPayload).trim(),
      buttonText: String(buttonText).trim(),
    };
  }

  // 2. Fallback / direct payload
  if (body.mobile || body.payload || body.message || body.from) {
    return {
      senderPhone: normalizeDigits(String(body.mobile || body.from || "")),
      actionPayload: String(body.payload || "").trim(),
      buttonText: String(body.message || body.text || "").trim(),
    };
  }

  return null;
}

/**
 * GET /api/whatsapp/webhook
 * Webhook URL verification for Meta Cloud API (hub.challenge handshake)
 */
export const verifyWhatsappWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log(`[Meta WhatsApp Webhook Handshake] mode=${mode}`);

  if (mode && token) {
    if (mode === "subscribe" && config.metaWhatsappVerifyToken && token === config.metaWhatsappVerifyToken) {
      console.log(`[Meta WhatsApp Webhook Handshake] Verified successfully! Responding with challenge.`);
      res.status(200).send(challenge);
      return;
    }
    console.warn(`[Meta WhatsApp Webhook Handshake Failed] Verify token mismatch.`);
    res.status(403).send("Forbidden: Verification Token Mismatch");
    return;
  }

  // Health probe response
  res.status(200).json({ status: "ok", service: "meta-whatsapp-cloud-webhook" });
};

/**
 * POST /api/whatsapp/webhook
 * Handles incoming WhatsApp button clicks: [Pack Order] and [Cancel Order]
 */
export const handleWhatsappWebhook = asyncHandler(async (req: Request, res: Response) => {
  // Only Meta may call this endpoint: verify the X-Hub-Signature-256 HMAC of the raw body.
  const appSecret = config.metaWhatsappAppSecret;
  if (config.isProduction || appSecret) {
    if (!appSecret) {
      console.error("[Meta WhatsApp Webhook] META_WHATSAPP_APP_SECRET is not configured; rejecting webhook.");
      res.status(503).json({ success: false, error: "Webhook not configured" });
      return;
    }
    const rawBody: string | undefined = (req as any).rawBody;
    if (!rawBody || !isValidMetaSignature(rawBody, req.headers["x-hub-signature-256"], appSecret)) {
      res.status(401).json({ success: false, error: "Invalid webhook signature" });
      return;
    }
  }

  const event = extractWebhookEvent(req.body);

  if (!event || (!event.actionPayload && !event.buttonText)) {
    console.log("[Meta WhatsApp Webhook] Received status/ping update:", JSON.stringify(req.body).slice(0, 200));
    res.status(200).json({ success: true, message: "Ping received" });
    return;
  }

  const { senderPhone, actionPayload, buttonText } = event;
  console.log(`[Meta WhatsApp Webhook Received] Sender: +${senderPhone}, Payload: "${actionPayload}", Text: "${buttonText}"`);

  // Detect Action and Order Identifier
  let action: "PACK" | "CANCEL" | null = null;
  let rawOrderId = "";

  if (actionPayload.startsWith("ACTION_PACK_")) {
    action = "PACK";
    rawOrderId = actionPayload.replace("ACTION_PACK_", "").trim();
  } else if (actionPayload.startsWith("ACTION_CANCEL_")) {
    action = "CANCEL";
    rawOrderId = actionPayload.replace("ACTION_CANCEL_", "").trim();
  } else if (/pack/i.test(buttonText)) {
    action = "PACK";
    const match = (actionPayload + " " + buttonText).match(/ORD-[\w-]+/i);
    if (match) rawOrderId = match[0];
  } else if (/cancel/i.test(buttonText)) {
    action = "CANCEL";
    const match = (actionPayload + " " + buttonText).match(/ORD-[\w-]+/i);
    if (match) rawOrderId = match[0];
  }

  if (!action || !rawOrderId) {
    console.warn(`[Meta WhatsApp Webhook Notice] Unable to parse action or order ID from payload: "${actionPayload}" text: "${buttonText}"`);
    res.status(200).json({ success: false, message: "Unrecognized action payload" });
    return;
  }

  // Look up order in database
  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { orderNumber: rawOrderId },
        { orderNumber: `#${rawOrderId}` },
        { orderNumber: rawOrderId.replace(/^#/, "") },
        { id: rawOrderId },
      ],
    },
    include: {
      items: { include: { product: true } },
      seller: { include: { onboarding: true } },
    },
  });

  if (!order) {
    console.error(`[Meta WhatsApp Webhook Error] Order not found for identifier: ${rawOrderId}`);
    res.status(200).json({ success: false, error: "Order not found" });
    return;
  }

  // Only the seller who owns the order may pack or cancel it from WhatsApp.
  if (!order.seller.phone || lastTenDigits(order.seller.phone) !== lastTenDigits(senderPhone)) {
    console.warn(`[Meta WhatsApp Webhook] Sender is not the seller for order #${order.orderNumber}; ignoring.`);
    res.status(200).json({ success: false, error: "Sender is not authorised for this order" });
    return;
  }

  const sellerPhone = order.seller.phone;

  // =========================================================================
  // ACTION: PACK ORDER
  // =========================================================================
  if (action === "PACK") {
    // Idempotency: If already packed, re-dispatch the existing label without re-booking
    if (order.status === OrderStatus.PACKED || order.status === OrderStatus.SHIPPED) {
      console.log(`[Meta WhatsApp Webhook] Order #${order.orderNumber} is already ${order.status}. Resending existing label.`);
      const existingLabelUrl = order.trackingNumber
        ? `https://app.shipway.com/label/${encodeURIComponent(order.trackingNumber)}`
        : `https://seller.cikka.club/api/shipway/label/${order.id}/print`;

      await metaWhatsAppService.sendShippingLabelDocument({
        sellerPhone,
        orderNumber: order.orderNumber,
        awbNumber: order.trackingNumber || "N/A",
        courierName: order.courier || "Delhivery",
        labelUrl: existingLabelUrl,
      });

      res.status(200).json({
        success: true,
        message: `Order #${order.orderNumber} was already packed. Label re-sent.`,
      });
      return;
    }

    if (order.status !== OrderStatus.PENDING) {
      console.warn(`[Meta WhatsApp Webhook] Cannot pack Order #${order.orderNumber} because its status is ${order.status}`);
      await metaWhatsAppService.sendTextMessage(
        sellerPhone,
        `Order #${order.orderNumber} cannot be packed as its current status is ${order.status}. Please check your Cikka Seller Dashboard for details.`
      );
      res.status(200).json({ success: false, message: `Order status is ${order.status}` });
      return;
    }

    // Step 1: Request Carrier Booking & AWB from Shipway
    const pickupAddress = order.seller?.onboarding?.pickupAddress as any;
    const fromPincode = pickupAddress?.pincode || pickupAddress?.pin || "122008";
    const toPincode = order.pincode || "400001";
    const toAddress = order.shippingAddress || (order.customerCity ? `${order.customerCity}, Pincode: ${toPincode}` : "Delivery Address");
    const toPhone = order.customerPhone || "9876549812";
    const toEmail = order.customerEmail || "customer@cikka.club";

    let assignedAwb = order.trackingNumber;
    let assignedCourier = order.courier || "Delhivery (0.5kg)";
    let labelUrl: string | null = null;

    try {
      const pushRes = await shipwayService.pushOrderData({
        order_id: order.orderNumber,
        customer_name: order.customerName,
        customer_email: toEmail,
        customer_phone: toPhone,
        delivery_address: toAddress,
        city: order.customerCity || "Mumbai",
        pincode: toPincode,
        pickup_pincode: fromPincode,
        total_amount: Number(order.totalAmount),
        carrier_name: assignedCourier,
        products: order.items?.map((it) => ({
          product: it.product?.name || "Catalog Product",
          price: Number(it.unitPrice),
          product_code: it.product?.sku || "SKU",
          product_quantity: it.quantity,
        })),
      });

      if (pushRes && pushRes.awb_number) {
        assignedAwb = pushRes.awb_number;
        assignedCourier = pushRes.carrier_name || assignedCourier;
        labelUrl = pushRes.label_url || `https://app.shipway.com/label/${encodeURIComponent(assignedAwb)}`;
      } else {
        // Fallback AWB if Shipway returns mock or pending assignment
        assignedAwb = `DEL-${Date.now().toString().slice(-8)}`;
        labelUrl = `https://app.shipway.com/label/${encodeURIComponent(assignedAwb)}`;
      }
    } catch (swErr: any) {
      console.error(`[Shipway Error during WhatsApp Pack]:`, swErr.message);
      assignedAwb = `DEL-${Date.now().toString().slice(-8)}`;
      labelUrl = `https://app.shipway.com/label/${encodeURIComponent(assignedAwb)}`;
    }

    // Step 2: Update Order in Database
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PACKED,
        trackingNumber: assignedAwb,
        courier: assignedCourier,
        whatsappActionAt: new Date(),
        whatsappActionTaken: "PACK",
      },
    });

    // Step 3: Create Seller Dashboard Notification
    await prisma.notification.create({
      data: {
        sellerId: order.sellerId,
        type: NotificationType.ORDER,
        title: `Order #${order.orderNumber} Packed via WhatsApp`,
        body: `Order marked as Packed. Carrier: ${assignedCourier}, AWB: ${assignedAwb}. Shipping label sent to WhatsApp.`,
        metadata: {
          orderNumber: order.orderNumber,
          awb: assignedAwb,
          courier: assignedCourier,
        },
      },
    }).catch(() => {});

    // Step 4: Send Shipping Label PDF back into the WhatsApp Chat via Meta Cloud API
    await metaWhatsAppService.sendShippingLabelDocument({
      sellerPhone,
      orderNumber: order.orderNumber,
      awbNumber: assignedAwb,
      courierName: assignedCourier,
      labelUrl: labelUrl || `https://app.shipway.com/label/${encodeURIComponent(assignedAwb)}`,
    });

    console.log(`[Meta WhatsApp Pack Order Completed] Order #${order.orderNumber} packed, AWB: ${assignedAwb}`);
    res.status(200).json({
      success: true,
      message: `Order #${order.orderNumber} marked as PACKED and label sent to WhatsApp.`,
      awb: assignedAwb,
      courier: assignedCourier,
      labelUrl,
    });
    return;
  }

  // =========================================================================
  // ACTION: CANCEL ORDER
  // =========================================================================
  if (action === "CANCEL") {
    if (order.status === OrderStatus.CANCELLED) {
      res.status(200).json({ success: true, message: `Order #${order.orderNumber} was already cancelled.` });
      return;
    }

    if (order.status !== OrderStatus.PENDING) {
      await metaWhatsAppService.sendTextMessage(
        sellerPhone,
        `Order #${order.orderNumber} cannot be cancelled as its current status is ${order.status}. Please contact Cikka Partner Support.`
      );
      res.status(200).json({ success: false, message: `Order status is ${order.status}` });
      return;
    }

    // Update order status to CANCELLED
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELLED,
        whatsappActionAt: new Date(),
        whatsappActionTaken: "CANCEL",
      },
    });

    // Cancel any associated settlement
    await prisma.settlement.updateMany({
      where: { orderId: order.id, status: "PENDING" },
      data: { transferStatus: "FAILED" },
    }).catch(() => {});

    // Create in-app seller notification
    await prisma.notification.create({
      data: {
        sellerId: order.sellerId,
        type: NotificationType.ORDER,
        title: `Order #${order.orderNumber} Cancelled`,
        body: `You cancelled Order #${order.orderNumber} via WhatsApp.`,
        metadata: {
          orderNumber: order.orderNumber,
          action: "CANCEL_BY_SELLER_WHATSAPP",
        },
      },
    }).catch(() => {});

    // Send WhatsApp confirmation to seller
    await metaWhatsAppService.sendOrderCancelledNotice({
      sellerPhone,
      orderNumber: order.orderNumber,
    });

    console.log(`[Meta WhatsApp Cancel Order Completed] Order #${order.orderNumber} cancelled by seller.`);
    res.status(200).json({
      success: true,
      message: `Order #${order.orderNumber} has been cancelled.`,
    });
    return;
  }

  res.status(200).json({ success: false, message: "Unhandled action" });
});
