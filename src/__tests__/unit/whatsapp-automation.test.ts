import { describe, it, expect } from "vitest";
import { orderSlaService } from "../../services/order-sla.service";
import { metaWhatsAppService } from "../../services/meta-whatsapp.service";

describe("Meta WhatsApp Cloud API Automation & SLA Calculation Tests", () => {
  it("should calculate correct Pack and Cancellation deadlines for orders placed before 18:00 IST", () => {
    // 2026-10-30 08:30:00 UTC = 14:00:00 IST (2:00 PM IST)
    const testOrderTime = new Date("2026-10-30T08:30:00.000Z");

    const sla = orderSlaService.calculateSlaDeadlines(testOrderTime);

    // Pack deadline should be next day: October 31, 2026 at 12:00 PM IST (= 06:30 UTC)
    expect(sla.packDeadline.toISOString()).toBe("2026-10-31T06:30:00.000Z");
    expect(sla.packDeadlineFormatted).toBe("12:00 PM on October 31, 2026");

    // Cancellation deadline should be 48 hours later: November 2, 2026 at 12:00 PM IST (= 06:30 UTC)
    expect(sla.cancellationDeadline.toISOString()).toBe("2026-11-02T06:30:00.000Z");
    expect(sla.cancellationDeadlineFormatted).toBe("November 2, 2026, at 12:00 PM");
  });

  it("should calculate correct deadlines for orders placed after 18:00 IST (adds +1 buffer day)", () => {
    // 2026-10-30 14:30:00 UTC = 20:00:00 IST (8:00 PM IST)
    const testOrderTime = new Date("2026-10-30T14:30:00.000Z");

    const sla = orderSlaService.calculateSlaDeadlines(testOrderTime);

    // Pack deadline should be 2 days later: November 1, 2026 at 12:00 PM IST (= 06:30 UTC)
    expect(sla.packDeadline.toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(sla.packDeadlineFormatted).toBe("12:00 PM on November 1, 2026");

    // Cancellation deadline should be 48 hours later: November 3, 2026 at 12:00 PM IST (= 06:30 UTC)
    expect(sla.cancellationDeadline.toISOString()).toBe("2026-11-03T06:30:00.000Z");
    expect(sla.cancellationDeadlineFormatted).toBe("November 3, 2026, at 12:00 PM");
  });

  it("should dispatch [URGENT] Meta WhatsApp order alert cleanly in mock/stub mode", async () => {
    const res = await metaWhatsAppService.sendNewOrderAlert({
      sellerPhone: "9876543210",
      sellerName: "Test Merchant",
      orderNumber: "ORD-TEST-9999",
      quantity: 2,
      productName: "Air Jordan 1",
      skuId: "SKU-AJ1-RED",
      packDeadlineFormatted: "12:00 PM on October 31, 2026",
      cancellationDeadlineFormatted: "November 2, 2026, at 12:00 PM",
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBeDefined();
  });

  it("should send Shipping Label document with mandatory SOP packing instructions via Meta Cloud API", async () => {
    const res = await metaWhatsAppService.sendShippingLabelDocument({
      sellerPhone: "9876543210",
      orderNumber: "ORD-TEST-9999",
      awbNumber: "DEL-98172635",
      courierName: "Delhivery Express Air",
      labelUrl: "https://app.shipway.com/label/DEL-98172635",
    });

    expect(res.success).toBe(true);
  });

  it("should send Order Cancelled notice cleanly via Meta Cloud API", async () => {
    const res = await metaWhatsAppService.sendOrderCancelledNotice({
      sellerPhone: "9876543210",
      orderNumber: "ORD-TEST-9999",
    });

    expect(res.success).toBe(true);
  });
});
