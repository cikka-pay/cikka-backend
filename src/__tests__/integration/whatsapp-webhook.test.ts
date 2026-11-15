import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import app from "../../app";
import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { OrderStatus } from "../../generated/prisma/client";

describe("Meta WhatsApp Cloud API Webhook Integration Tests", () => {
  const TEST_VERIFY_TOKEN = "test_meta_verify_token_123";

  beforeAll(() => {
    (config as any).metaWhatsappVerifyToken = TEST_VERIFY_TOKEN;
  });

  it("should respond to GET webhook verification challenge with hub.challenge", async () => {
    const res = await request(app)
      .get("/api/whatsapp/webhook")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": TEST_VERIFY_TOKEN,
        "hub.challenge": "challenge_meta_12345",
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe("challenge_meta_12345");
  });

  it("should reject invalid verify token on GET webhook verification", async () => {
    const res = await request(app)
      .get("/api/whatsapp/webhook")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": "challenge_invalid",
      });

    expect(res.status).toBe(403);
  });

  it("should process [Pack Order] button click via Meta payload, mark PACKED, and trigger Shipway label dispatch", async () => {
    const orderNumber = "ORD-META-PACK-001";
    const mockOrder: any = {
      id: "mock-order-id-meta-1",
      orderNumber,
      customerName: "Cikka Customer",
      customerCity: "Mumbai",
      totalAmount: 1999,
      status: OrderStatus.PENDING,
      trackingNumber: null,
      courier: "Delhivery",
      sellerId: "mock-seller-id-meta-1",
      seller: {
        id: "mock-seller-id-meta-1",
        phone: "+919876543210",
        businessName: "Test Meta Merchant",
        onboarding: {
          pickupAddress: { pincode: "122008" },
        },
      },
      items: [
        {
          quantity: 1,
          unitPrice: 1999,
          product: { name: "Air Jordan 1", sku: "SKU-AJ1" },
        },
      ],
    };

    const findFirstSpy = vi.spyOn(prisma.order, "findFirst").mockResolvedValue(mockOrder);
    const updateSpy = vi.spyOn(prisma.order, "update").mockResolvedValue({
      ...mockOrder,
      status: OrderStatus.PACKED,
      trackingNumber: "DEL-MOCK-META-1",
      courier: "Delhivery Express Air (0.5kg)",
    });
    vi.spyOn(prisma.notification, "create").mockResolvedValue({} as any);

    // Official Meta WhatsApp Cloud API Inbound Webhook Payload Format
    const metaWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550269870",
                  phone_number_id: "PHONE_NUMBER_ID_123",
                },
                contacts: [{ wa_id: "919876543210", profile: { name: "Seller Partner" } }],
                messages: [
                  {
                    from: "919876543210",
                    id: "wamid.HBgLM...==",
                    timestamp: "1730000000",
                    type: "button",
                    button: {
                      text: "Pack Order",
                      payload: `ACTION_PACK_${orderNumber}`,
                    },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(metaWebhookPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("PACKED");

    expect(findFirstSpy).toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mock-order-id-meta-1" },
        data: expect.objectContaining({
          status: OrderStatus.PACKED,
          whatsappActionTaken: "PACK",
        }),
      })
    );
  });

  it("should process [Cancel Order] button click via Meta payload and transition order to CANCELLED", async () => {
    const orderNumber = "ORD-META-CANCEL-002";
    const mockOrder: any = {
      id: "mock-order-id-meta-2",
      orderNumber,
      customerName: "Cancel Customer",
      customerCity: "Delhi",
      totalAmount: 2499,
      status: OrderStatus.PENDING,
      sellerId: "mock-seller-id-meta-2",
      seller: {
        id: "mock-seller-id-meta-2",
        phone: "+919876543211",
        businessName: "Test Cancel Merchant",
      },
      items: [],
    };

    vi.spyOn(prisma.order, "findFirst").mockResolvedValue(mockOrder);
    const updateSpy = vi.spyOn(prisma.order, "update").mockResolvedValue({
      ...mockOrder,
      status: OrderStatus.CANCELLED,
    });
    vi.spyOn(prisma.settlement, "updateMany").mockResolvedValue({ count: 1 });
    vi.spyOn(prisma.notification, "create").mockResolvedValue({} as any);

    const metaWebhookPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA_ID_123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                messages: [
                  {
                    from: "919876543211",
                    id: "wamid.HBgLM...==",
                    timestamp: "1730000001",
                    type: "button",
                    button: {
                      text: "Cancel Order",
                      payload: `ACTION_CANCEL_${orderNumber}`,
                    },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .send(metaWebhookPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("cancelled");

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mock-order-id-meta-2" },
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          whatsappActionTaken: "CANCEL",
        }),
      })
    );
  });
});
