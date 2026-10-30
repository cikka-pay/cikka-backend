import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../config/prisma";
import { Prisma, OrderStatus } from "../generated/prisma/client";
import { shipwayService } from "../services/shipway.service";

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

  const { customerName, customerCity, totalAmount, customerEmail, customerPhone, deliveryAddress, sku, productId, items } = req.body;
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

  let order;
  try {
    order = await prisma.order.create({
      data: {
        sellerId,
        orderNumber,
        customerName: customerName || "Cikka Customer",
        customerCity: customerCity || "Mumbai",
        totalAmount: finalAmount,
        status: OrderStatus.PENDING,
        courier: null,
        trackingNumber: null,
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
    const toPincode = (order as any).pincode || "400001";

    const pushRes = await shipwayService.pushOrderData({
      order_id: order.orderNumber,
      customer_name: order.customerName,
      customer_email: (order as any).customerEmail || "customer@cikka.club",
      customer_phone: (order as any).customerPhone || "9876543210",
      delivery_address: `${order.customerCity || "Mumbai"}, India`,
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

  res.json({
    ...updatedOrder,
    labelUrl,
  });
});
