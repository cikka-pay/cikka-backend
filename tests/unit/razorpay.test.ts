import { razorpayService } from "../../src/services/razorpay.service";

describe("Razorpay Service Unit Tests", () => {
  describe("createOrder", () => {
    it("should throw error if order amount is less than 100 paise", async () => {
      await expect(razorpayService.createOrder({ amount: 50 })).rejects.toThrow(
        "Minimum order amount must be at least 100 paise"
      );
    });

    it("should create an order with order_id, amount, currency, and key_id", async () => {
      const order = await razorpayService.createOrder({
        amount: 3348900, // ₹33,489.00 in paise
        currency: "INR",
        receipt: "rcpt_test_123",
      });

      expect(order).toBeDefined();
      expect(order.order_id).toBeDefined();
      expect(order.amount).toBe(3348900);
      expect(order.currency).toBe("INR");
      expect(order.key_id).toBeDefined();
    });
  });

  describe("verifyPaymentSignature", () => {
    it("should return false if missing parameters", () => {
      const isValid = razorpayService.verifyPaymentSignature("", "", "");
      expect(isValid).toBe(false);
    });

    it("should return true for dev bypass orders", () => {
      const isValid = razorpayService.verifyPaymentSignature(
        "order_dev_123456789",
        "pay_dev_123456789",
        "any_sig"
      );
      expect(isValid).toBe(true);
    });
  });
});
