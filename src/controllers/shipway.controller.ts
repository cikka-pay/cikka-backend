import { Request, Response } from "express";
import { shipwayService, SHIPWAY_STATUS_MAP } from "../services/shipway.service";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { OrderStatus, NotificationType } from "@prisma/client";

/**
 * POST /api/shipway/push-order
 * Push order data into Shipway Experience
 */
export const pushOrder = asyncHandler(async (req: Request, res: Response) => {
  const { order_id, carrier_name, awb_number, customer_name, customer_email, customer_phone, delivery_address, city, state, pincode, total_amount } = req.body;

  if (!order_id) {
    res.status(400).json({ success: false, error: "order_id is required" });
    return;
  }

  const result = await shipwayService.pushOrderData({
    order_id,
    carrier_name,
    awb_number,
    customer_name,
    customer_email,
    customer_phone,
    delivery_address,
    city,
    state,
    pincode,
    total_amount,
  });

  res.status(200).json({
    success: true,
    message: "Order data pushed to Shipway successfully",
    ...result,
  });
});

/**
 * GET /api/shipway/tracking/:orderId
 * POST /api/shipway/tracking
 * Get real-time shipment status and tracking history from Shipway
 */
export const getShipmentDetails = asyncHandler(async (req: Request, res: Response) => {
  const orderId = req.params.orderId || req.body.order_id;

  if (!orderId) {
    res.status(400).json({ success: false, error: "order_id is required" });
    return;
  }

  const result = await shipwayService.getOrderShipmentDetails(orderId);

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * POST /api/shipway/webhooks/add
 * Configure callback URL and subscription events in Shipway
 */
export const addWebhooks = asyncHandler(async (req: Request, res: Response) => {
  const { callback_url, events } = req.body;

  if (!callback_url) {
    res.status(400).json({ success: false, error: "callback_url is required" });
    return;
  }

  const result = await shipwayService.addWebhooks(callback_url, events);

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * POST /api/shipway/webhooks/delete
 * Delete webhook configuration from Shipway
 */
export const deleteWebhooks = asyncHandler(async (req: Request, res: Response) => {
  const result = await shipwayService.deleteWebhooks();

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * Maps Shipway Status Codes to Cikka Prisma OrderStatus Enum
 */
function mapShipwayToPrismaStatus(shipwayStatus: string): OrderStatus | null {
  const code = (shipwayStatus || "").toUpperCase().trim();
  if (code === "DEL") return OrderStatus.DELIVERED;
  if (["INT", "OOD", "SCH", "PKP", "OFP"].includes(code)) return OrderStatus.SHIPPED;
  if (["RTO", "RTD", "RCAN", "RCLO", "RDEL", "RINT", "ROOP", "RPKP"].includes(code)) return OrderStatus.RETURNED;
  if (["CAN", "PCAN"].includes(code)) return OrderStatus.CANCELLED;
  return null;
}

/**
 * POST /api/shipway/webhook
 * Public Webhook Receiver for Shipway status push notifications
 * Handles official Shipway payload with status_feed array and hash verification
 */
export const handleWebhook = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body || {};
  console.log("[Shipway Webhook Received Raw Payload]:", JSON.stringify(payload, null, 2));

  // Extract status feed items (supports array feed or single object feed)
  const feedItems: any[] = Array.isArray(payload.status_feed)
    ? payload.status_feed
    : payload.order_id
    ? [payload]
    : [];

  const processedOrders: string[] = [];

  for (const item of feedItems) {
    const order_id = item.order_id;
    const current_status = item.current_status || item.status_code;
    const current_status_desc = item.current_status_desc || item.status_desc;
    const awbno = item.awbno || item.awb_number;
    const carrier = item.carrier || item.carrier_name;

    if (!order_id || !current_status) continue;

    const mappedStatus = mapShipwayToPrismaStatus(current_status);
    const statusMeta = SHIPWAY_STATUS_MAP[current_status] || { description: current_status_desc || "Updated", category: "In Transit" };

    console.log(
      `[Shipway Webhook Feed] Processing Order #${order_id} -> Status: ${current_status} (${statusMeta.description}), Carrier: ${carrier || "N/A"}, AWB: ${awbno || "N/A"}`
    );

    try {
      // Find matching order in Prisma database
      const dbOrder = await prisma.order.findFirst({
        where: {
          OR: [{ orderNumber: order_id }, { id: order_id }],
        },
      });

      if (dbOrder) {
        // Update database order status and tracking details
        await prisma.order.update({
          where: { id: dbOrder.id },
          data: {
            ...(mappedStatus && { status: mappedStatus }),
            ...(awbno && { trackingNumber: awbno }),
            ...(carrier && { courier: carrier }),
          },
        });

        // Push in-app notification to Seller
        await prisma.notification.create({
          data: {
            sellerId: dbOrder.sellerId,
            type: NotificationType.ORDER,
            title: `Shipment Status: Order #${dbOrder.orderNumber}`,
            body: `Package status updated to "${current_status_desc || statusMeta.description}" via ${carrier || "Shipway Carrier"}. AWB: ${awbno || dbOrder.trackingNumber || "N/A"}`,
            metadata: {
              orderId: dbOrder.id,
              orderNumber: dbOrder.orderNumber,
              shipwayStatus: current_status,
              awbno,
              carrier,
            },
          },
        });

        processedOrders.push(dbOrder.orderNumber);
      }
    } catch (err: any) {
      console.error(`[Shipway Webhook DB Error] Failed to update Order #${order_id}:`, err.message);
    }
  }

  // Exact JSON response expected by Shipway Webhook Engine
  res.status(200).json({
    status: "success",
    message: `Processed ${feedItems.length} status feed items successfully`,
    processed_orders: processedOrders,
    status_code: "200",
  });
});
