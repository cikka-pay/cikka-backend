import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, OrderStatus, WalletTxType } from "../generated/prisma/client";
import { walletService } from "../services/wallet.service";
import { shipwayService } from "../services/shipway.service";
import { orderSlaService } from "../services/order-sla.service";
import { metaWhatsAppService } from "../services/meta-whatsapp.service";

export const listOrders = asyncHandler(async (req: Request, res: Response) => {
  const sellerId = req.seller!.id;
  const { page = "1", limit = "100", status, startDate, endDate, productId, search } = req.query as any;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = Math.min(parseInt(limit, 10) || 100, 1000);
  const skip = (pageNum - 1) * limitNum;

  const where: Prisma.OrderWhereInput = { sellerId };

  if (status && status !== "ALL") {
    where.status = status as OrderStatus;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate);
    }
  }

  if (productId && productId !== "ALL") {
    where.items = {
      some: {
        productId: productId,
      },
    };
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customerCity: { contains: q, mode: "insensitive" } },
      { items: { some: { product: { name: { contains: q, mode: "insensitive" } } } } },
      { items: { some: { product: { sku: { contains: q, mode: "insensitive" } } } } },
    ];
  }

  const [rawOrders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { product: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  // Redact customer PII for Seller view while maintaining shipment metadata (Pincode, City, Delivery Partner, AWB, Status)
  const sanitizedOrders = rawOrders.map((order) => {
    return {
      ...order,
      status: order.status,
      trackingNumber: order.trackingNumber || null,
      courier: order.courier || "Bluedart / Delhivery (0.5kg)",
      customerName: "Cikka Customer",
      customerPhone: "••••••••••",
      customerEmail: "••••••••••",
      deliveryAddressRedacted: `${order.customerCity || "City"}, Pincode: ${(order as any).pincode || "Destination Pincode"}`,
    };
  });

  res.json({
    data: sanitizedOrders,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, sellerId: req.seller!.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // Redact customer PII for Seller view
  const sanitizedOrder = {
    ...order,
    status: order.status,
    trackingNumber: order.trackingNumber || null,
    courier: order.courier || "Bluedart / Delhivery (0.5kg)",
    customerName: "Cikka Customer",
    customerPhone: "••••••••••",
    customerEmail: "••••••••••",
    deliveryAddressRedacted: `${order.customerCity || "City"}, Pincode: ${(order as any).pincode || "Destination Pincode"}`,
  };

  res.json(sanitizedOrder);
});


export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const rawSellerId = req.seller?.id || req.body?.sellerId;
  let seller = null;

  if (rawSellerId) {
    seller = await prisma.seller.findFirst({
      where: {
        OR: [
          { id: rawSellerId },
          { onboarding: { applicationId: rawSellerId } },
          { businessName: { equals: rawSellerId, mode: "insensitive" } },
        ],
      },
    });
  }

  // Fallback to first registered seller if specific Cikka ID or rawSellerId is not found
  if (!seller) {
    seller = await prisma.seller.findFirst();
  }

  if (!seller) {
    res.status(400).json({ error: "No registered seller found in database to attach order to. Please complete onboarding first." });
    return;
  }

  const sellerId = seller.id;

  const { customerName, customerCity, totalAmount, customerEmail, customerPhone, deliveryAddress, pincode, sku, productId, items } = req.body;
  const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

  // Find product by SKU or productId if provided
  let targetProduct = null;
  if (sku) {
    targetProduct = await prisma.product.findFirst({
      where: { sku: { equals: sku, mode: "insensitive" } },
    });
  } else if (productId) {
    targetProduct = await prisma.product.findUnique({
      where: { id: productId },
    });
  }

  const finalAmount = totalAmount || (targetProduct ? Number(targetProduct.price) : 32989);
  const sla = orderSlaService.calculateSlaDeadlines();

  let order;
  try {
    order = await prisma.order.create({
      data: {
        sellerId,
        orderNumber,
        customerName: customerName || "Cikka Customer",
        customerEmail: customerEmail || null,
        customerPhone: customerPhone || null,
        customerCity: customerCity || "Mumbai",
        shippingAddress: deliveryAddress || null,
        pincode: pincode || null,
        totalAmount: finalAmount,
        status: OrderStatus.PENDING,
        courier: null,
        trackingNumber: null,
        packDeadline: sla.packDeadline,
        cancellationDeadline: sla.cancellationDeadline,
        ...(targetProduct && {
          items: {
            create: [
              {
                productId: targetProduct.id,
                quantity: 1,
                unitPrice: targetProduct.price,
              },
            ],
          },
        }),
      },
      include: {
        items: { include: { product: true } },
      },
    });
  } catch (dbError: any) {
    console.error(`[Order Creation DB Error]`, dbError);
    res.status(500).json({ error: dbError.message || "Failed to create order in database" });
    return;
  }

  // Automated Meta WhatsApp alert to seller
  const sellerPhone = seller.phone || (seller as any)?.onboarding?.signatoryMobile;
  const sellerBiz = seller.businessName || (seller as any)?.onboarding?.businessName || "Seller Partner";
  if (sellerPhone) {
    metaWhatsAppService.sendNewOrderAlert({
      sellerPhone,
      sellerName: sellerBiz,
      orderNumber,
      quantity: 1,
      productName: targetProduct?.name || "Curated Mall Product",
      skuId: targetProduct?.sku || "SKU-CIKKA",
      packDeadlineFormatted: sla.packDeadlineFormatted,
      cancellationDeadlineFormatted: sla.cancellationDeadlineFormatted,
    }).then((waRes) => {
      if (waRes.success && waRes.messageId) {
        prisma.order.update({
          where: { id: order.id },
          data: {
            whatsappNotifiedAt: new Date(),
            whatsappMessageId: waRes.messageId,
          },
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  res.status(201).json({
    success: true,
    message: "Order created successfully. Ready to be packed by seller.",
    order,
  });
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const sellerId = req.seller!.id;
  const { status, trackingNumber, courier } = req.body;

  const order = await prisma.order.findFirst({
    where: { id, sellerId },
    include: {
      items: { include: { product: true } },
      seller: { include: { onboarding: true } },
    },
  });

  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  let assignedAwb = trackingNumber || order.trackingNumber;
  let assignedCourier = courier || order.courier;

  // When seller packs the order, request REAL carrier allocation from Shipway
  if (status === "PACKED" && !assignedAwb) {
    const pickupAddress = order.seller?.onboarding?.pickupAddress as any;
    const fromPincode = pickupAddress?.pincode || pickupAddress?.pin || "122008";
    const toPincode = order.pincode || "400001";
    const toAddress = order.shippingAddress || (order.customerCity ? `${order.customerCity}, Pincode: ${toPincode}` : "Delivery Address");
    const toEmail = order.customerEmail || "customer@cikka.club";
    const toPhone = order.customerPhone || "9876543210";

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
      carrier_name: courier || order.courier,
      products: order.items?.map((it) => ({
        product: it.product?.name || "Catalog Product",
        price: Number(it.unitPrice),
        product_code: it.product?.sku || "SKU",
        product_quantity: it.quantity,
      })),
    });

    if (pushRes.status === "failed" || !pushRes.awb_number) {
      res.status(400).json({
        error: `Shipway Allocation Failed: ${pushRes.message || "Shipway could not allocate an official AWB. Please check courier integrations and wallet balance."}`,
      });
      return;
    }

    assignedAwb = pushRes.awb_number;
    assignedCourier = pushRes.carrier_name || assignedCourier || "Shipway Courier";
  }

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: {
      status,
      trackingNumber: assignedAwb,
      courier: assignedCourier,
    },
  });

  const labelUrl = assignedAwb ? `https://app.shipway.com/label/${encodeURIComponent(assignedAwb)}` : null;
  if (status === "PACKED" && labelUrl) {
    const sellerPhone = order.seller?.phone || (order.seller?.onboarding as any)?.signatoryMobile;
    if (sellerPhone) {
      metaWhatsAppService.sendShippingLabelDocument({
        sellerPhone,
        orderNumber: order.orderNumber,
        awbNumber: assignedAwb,
        courierName: assignedCourier,
        labelUrl,
      }).catch((waErr: any) => {
        console.warn(`[WhatsApp Label Dispatch Notice] Order #${order.orderNumber}:`, waErr.message);
      });
    }
  }
  res.json({
    ...updatedOrder,
    labelUrl,
  });
});
/**
 * GET /api/user/orders or /api/orders/user
 * Fetch authenticated user's order history with real-time tracking progression
 */
export const listUserOrders = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  // Orders are only ever looked up for the authenticated user (never by a phone number in the query)
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required to view orders" });
    return;
  }

  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              imageUrls: true,
              price: true,
              sku: true,
              category: true,
              brandName: true,
            },
          },
        },
      },
      seller: {
        select: {
          businessName: true,
        },
      },
    },
  });

  const formattedOrders = orders.map((o) => {
    const isPending = o.status === OrderStatus.PENDING;
    const isPacked = o.status === OrderStatus.PACKED;
    const isShipped = o.status === OrderStatus.SHIPPED;
    const isDelivered = o.status === OrderStatus.DELIVERED;
    const isCancelled = o.status === OrderStatus.CANCELLED;

    const trackingHistory = [
      {
        step: "Order Confirmed",
        date: new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
        done: true,
        current: isPending,
      },
      {
        step: "Packed & Handed to Carrier",
        date: isPacked || isShipped || isDelivered ? "Dispatched from Warehouse" : "Awaiting Packaging",
        done: isPacked || isShipped || isDelivered,
        current: isPacked,
      },
      {
        step: o.courier ? `In Transit (${o.courier})` : "In Transit",
        date: o.trackingNumber ? `AWB #${o.trackingNumber}` : "Carrier allocation in progress",
        done: isShipped || isDelivered,
        current: isShipped,
      },
      {
        step: "Out for Delivery",
        date: isDelivered ? "Reached Destination Hub" : "En route to delivery address",
        done: isDelivered,
        current: false,
      },
      {
        step: "Delivered",
        date: o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Estimated 2-3 business days",
        done: isDelivered,
        current: isDelivered,
      },
    ];

    const firstItem = o.items[0];
    const rawImages = firstItem?.product?.imageUrls;
    let resolvedImage = "";
    if (Array.isArray(rawImages) && rawImages.length > 0) resolvedImage = String(rawImages[0]);
    else if (typeof rawImages === "string") {
      try {
        const p = JSON.parse(rawImages);
        resolvedImage = Array.isArray(p) ? String(p[0]) : rawImages;
      } catch {
        resolvedImage = rawImages;
      }
    }

    return {
      id: o.orderNumber || o.id,
      internalId: o.id,
      title: firstItem?.product?.name || "Cikka Mall Curated Order",
      brand: firstItem?.product?.brandName || o.seller?.businessName || "Cikka Mall",
      variant: firstItem?.variantId || "Standard",
      image: resolvedImage || "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80",
      price: `₹${Number(o.totalAmount).toLocaleString("en-IN")}`,
      totalAmount: Number(o.totalAmount),
      date: new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      status: o.status,
      statusText: o.status === OrderStatus.DELIVERED ? "Delivered" : o.status === OrderStatus.SHIPPED ? "In Transit" : o.status === OrderStatus.PACKED ? "Packed" : o.status === OrderStatus.CANCELLED ? "Cancelled" : "Confirmed",
      statusSubtext: o.status === OrderStatus.DELIVERED
        ? `Delivered on ${o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "recent"}`
        : o.trackingNumber
        ? `${o.courier || "Carrier"} (AWB #${o.trackingNumber})`
        : "Preparing for dispatch",
      courier: o.courier || "Shipway Automated Dispatch",
      trackingNumber: o.trackingNumber,
      trackingHistory,
      items: o.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.product?.name || "Product",
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
      })),
      canCancel: isPending || isPacked,
    };
  });

  res.status(200).json({
    success: true,
    orders: formattedOrders,
    count: formattedOrders.length,
  });
});

/**
 * POST /api/user/orders/:id/cancel
 * Cancel an order if it is still PENDING or PACKED
 */
export const cancelUserOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required to cancel an order" });
    return;
  }

  const order = await prisma.order.findFirst({
    where: {
      OR: [{ id }, { orderNumber: id }],
      userId,
    },
    include: { items: true },
  });

  if (!order) {
    res.status(404).json({ success: false, error: "Order not found" });
    return;
  }

  if (order.status === OrderStatus.SHIPPED || order.status === OrderStatus.DELIVERED) {
    res.status(400).json({
      success: false,
      error: "Order has already been dispatched and cannot be cancelled directly. Please initiate an exchange or return upon delivery.",
    });
    return;
  }

  if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.PACKED) {
    res.status(400).json({ success: false, error: `Order cannot be cancelled in status ${order.status}` });
    return;
  }

  // Transition atomically so a repeated or concurrent cancel can't restore points/stock twice
  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: { in: [OrderStatus.PENDING, OrderStatus.PACKED] } },
    data: { status: OrderStatus.CANCELLED },
  });
  if (count === 0) {
    res.status(409).json({ success: false, error: "Order status changed; please refresh and try again" });
    return;
  }

  // Check if this was a Rewards Store order (starts with ORD-RW- or customerName includes RDM-)
  const isRewardOrder =
    order.orderNumber.startsWith("ORD-RW-") ||
    Boolean(order.customerName && order.customerName.includes("RDM-"));

  if (isRewardOrder && order.userId) {
    const pointsToRefund = Math.round(Number(order.totalAmount));
    if (pointsToRefund > 0) {
      await walletService
        .creditPoints(order.userId, pointsToRefund, WalletTxType.EARN_ADMIN, {
          description: "Order Cancelled • Points Restored",
          idempotencyKey: `ORDER_CANCEL_REFUND:${order.id}`,
          orderId: order.id,
        })
        .catch((err: any) => {
          console.warn(`[cancelUserOrder] Points rollback warning: ${err.message}`);
        });
    }

    // Restore inventory
    if (order.items && order.items.length > 0) {
      for (const it of order.items) {
        await prisma.product
          .update({
            where: { id: it.productId },
            data: { stockQty: { increment: it.quantity } },
          })
          .catch(() => {});
      }
    }
  }

  const updated = await prisma.order.findUnique({ where: { id: order.id } });

  res.status(200).json({
    success: true,
    message: "Order cancelled successfully",
    order: updated,
  });
});
