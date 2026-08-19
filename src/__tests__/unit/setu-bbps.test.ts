import { describe, it, expect } from "vitest";
import { setuBbpsStub } from "../../external/setu/setu-bbps.client";
import { checkPaymentStatusService } from "../../services/setu.service";

describe("Setu BBPS Unit Tests", () => {
  it("should list BBPS categories", async () => {
    const categories = await setuBbpsStub.getCategories();
    expect(categories.length).toBeGreaterThan(0);
    expect(categories.some((c) => c.code === "ELECTRICITY")).toBe(true);
  });

  it("should list billers by category", async () => {
    const billers = await setuBbpsStub.getBillers("ELECTRICITY");
    expect(billers.length).toBeGreaterThan(0);
    expect(billers[0].category).toBe("ELECTRICITY");
  });

  it("should fetch bill details for a consumer", async () => {
    const bill = await setuBbpsStub.fetchBill({
      billerId: "BESCOM000KAR01",
      customerParams: { consumer_number: "123456789" },
    });
    expect(bill.setuBillId).toBeDefined();
    expect(bill.billAmount).toBe(1450.0);
  });

  it("should process mock bill payment", async () => {
    const payment = await setuBbpsStub.payBill({
      refID: "TEST-REF-101",
      billerId: "BESCOM000KAR01",
      amount: 1450.0,
      customerParams: { consumer_number: "123456789" },
    });
    expect(payment.refID).toBe("TEST-REF-101");
    expect(payment.status).toBe("SUCCESS");
    expect(payment.bbpsRefNo).toBeDefined();
  });

  it("should handle checkPaymentStatusService for missing refID", async () => {
    await expect(checkPaymentStatusService({} as any)).rejects.toThrow();
  });
});
