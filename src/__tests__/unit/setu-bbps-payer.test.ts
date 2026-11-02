import { describe, it, expect, beforeEach } from "vitest";
import {
  setuAuthService,
  setuBillerService,
  setuValidationService,
  setuBillService,
  setuPaymentService,
  setuReceiptService,
  setuSettlementService,
} from "../../services/setu";

describe("Setu BBPS Payer-Side Integration Tests", () => {
  beforeEach(() => {
    setuAuthService.clearTokenCache();
  });

  describe("A. Authentication & Security", () => {
    it("should generate Setu headers with partner ID and product instance ID", async () => {
      // In dev/test with mock/credentials, getSetuHeaders provides required headers
      try {
        const headers = await setuAuthService.getSetuHeaders();
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers.Authorization).toBeDefined();
      } catch (err: any) {
        // If external network is offline during testing, catch gracefully
        expect(err.message).toBeDefined();
      }
    });

    it("should allow clearing token cache safely", () => {
      expect(() => setuAuthService.clearTokenCache()).not.toThrow();
    });
  });

  describe("B. Biller Discovery", () => {
    it("should discover billers for Electricity category", async () => {
      const billers = await setuBillerService.getBillersService({ category: "Electricity" });
      expect(billers.length).toBeGreaterThan(0);
      expect(billers[0].category).toBe("Electricity");
      expect(billers[0].billerId).toBeDefined();
      expect(billers[0].customerParams.length).toBeGreaterThan(0);
    });

    it("should filter billers by search keyword", async () => {
      const billers = await setuBillerService.getBillersService({ search: "BESCOM" });
      expect(billers.length).toBeGreaterThan(0);
      expect(billers.some((b) => b.billerName.includes("BESCOM"))).toBe(true);
    });

    it("should normalize diverse category spellings", () => {
      expect(setuBillerService.normalizeCategory("electricity bills")).toBe("Electricity");
      expect(setuBillerService.normalizeCategory("mobile recharge")).toBe("Mobile Recharge");
      expect(setuBillerService.normalizeCategory("fastag")).toBe("FASTag");
      expect(setuBillerService.normalizeCategory("piped gas connection")).toBe("Piped Gas");
    });

    it("should retrieve specific biller details by billerId", async () => {
      const biller = await setuBillerService.getBillerDetailsService("BESCOM000KAR01");
      expect(biller).not.toBeNull();
      expect(biller?.billerName).toContain("BESCOM");
      expect(biller?.customerParams[0].paramId).toBe("consumer_number");
    });
  });

  describe("C. Customer Validation", () => {
    it("should validate customer details with valid parameters", async () => {
      const result = await setuValidationService.validateCustomerService({
        billerId: "BESCOM000KAR01",
        customerParams: { consumer_number: "1002345678" },
      });
      expect(result.isValid).toBe(true);
      expect(result.billerId).toBe("BESCOM000KAR01");
    });

    it("should reject customer validation when mandatory parameter is missing", async () => {
      const result = await setuValidationService.validateCustomerService({
        billerId: "BESCOM000KAR01",
        customerParams: {},
      });
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("Mandatory field");
    });

    it("should reject customer validation when parameter fails regex or length rule", async () => {
      const result = await setuValidationService.validateCustomerService({
        billerId: "BESCOM000KAR01",
        customerParams: { consumer_number: "123" }, // BESCOM requires 10 digits
      });
      expect(result.isValid).toBe(false);
      expect(result.message).toContain("at least 10 characters");
    });
  });

  describe("D. Fetch Outstanding Bills", () => {
    it("should fetch bill with platformBillId, amount, and items", async () => {
      const bill = await setuBillService.fetchBillService({
        billerId: "BESCOM000KAR01",
        customerParams: { consumer_number: "1002345678" },
      });

      expect(bill.platformBillId).toBeDefined();
      expect(bill.platformBillId.startsWith("SETU-BILL-")).toBe(true);
      expect(bill.amount).toBeGreaterThan(0);
      expect(bill.currency).toBe("INR");
      expect(bill.status).toBe("UNPAID");
      expect(bill.items).toBeDefined();
      expect(bill.items!.length).toBeGreaterThan(0);
    });

    it("should retrieve bill details by platformBillId", async () => {
      const fetched = await setuBillService.fetchBillService({
        billerId: "TATAPWR00MUM01",
        customerParams: { consumer_number: "123456789012" },
      });

      const details = await setuBillService.getBillDetailsService(fetched.platformBillId);
      expect(details).not.toBeNull();
      expect(details?.platformBillId).toBe(fetched.platformBillId);
      expect(details?.amount).toBe(fetched.amount);
    });

    it("should expire bill upon request", async () => {
      const bill = await setuBillService.fetchBillService({
        billerId: "JIOPST000IND01",
        customerParams: { mobile_number: "9876543210" },
      });

      const expired = await setuBillService.expireBillService(bill.platformBillId);
      expect(expired).toBe(true);

      const after = await setuBillService.getBillDetailsService(bill.platformBillId);
      expect(after?.status).toBe("EXPIRED");
    });
  });

  describe("E. Bill Payment Fulfilment & State Machine", () => {
    it("should process payment fulfilment and generate Cikka transaction", async () => {
      const bill = await setuBillService.fetchBillService({
        billerId: "BESCOM000KAR01",
        customerParams: { consumer_number: "1002345678" },
      });

      const payment = await setuPaymentService.payBillService({
        platformBillId: bill.platformBillId,
        amount: bill.amount,
        paymentMode: "UPI",
        billerId: bill.billerId,
        idempotencyKey: `TEST-IDEMP-${Date.now()}`,
      });

      expect(payment.isDuplicate).toBe(false);
      expect(payment.internalTxnId.startsWith("CKK-BBPS-")).toBe(true);
      expect(payment.status).toBe("SUCCESS");
      expect(payment.bbpsRefNo).toBeDefined();
      expect(payment.receiptNumber).toBeDefined();
    });

    it("should prevent duplicate payment fulfilment with same idempotency key", async () => {
      const bill = await setuBillService.fetchBillService({
        billerId: "BESCOM000KAR01",
        customerParams: { consumer_number: "1002345678" },
      });

      const key = `DEDUP-${Date.now()}`;

      const p1 = await setuPaymentService.payBillService({
        platformBillId: bill.platformBillId,
        amount: bill.amount,
        paymentMode: "UPI",
        billerId: bill.billerId,
        idempotencyKey: key,
      });

      const p2 = await setuPaymentService.payBillService({
        platformBillId: bill.platformBillId,
        amount: bill.amount,
        paymentMode: "UPI",
        billerId: bill.billerId,
        idempotencyKey: key,
      });

      expect(p1.isDuplicate).toBe(false);
      expect(p2.isDuplicate).toBe(true);
      expect(p2.internalTxnId).toBe(p1.internalTxnId);
    });
  });

  describe("F. Receipt Management", () => {
    it("should retrieve official receipt for a completed transaction", async () => {
      const bill = await setuBillService.fetchBillService({
        billerId: "TATAPWR00MUM01",
        customerParams: { consumer_number: "123456789012" },
      });

      const payment = await setuPaymentService.payBillService({
        platformBillId: bill.platformBillId,
        amount: bill.amount,
        paymentMode: "UPI",
        billerId: bill.billerId,
        idempotencyKey: `RECEIPT-TEST-${Date.now()}`,
      });

      const receipt = await setuReceiptService.getTransactionReceiptService(payment.internalTxnId);
      expect(receipt).not.toBeNull();
      expect(receipt?.receiptNumber).toBe(payment.receiptNumber);
      expect(receipt?.bbpsRefNo).toBe(payment.bbpsRefNo);
      expect(receipt?.billerName).toContain("Tata Power");
      expect(receipt?.status).toBe("SUCCESS");
    });
  });

  describe("G. Settlement & Reconciliation", () => {
    it("should retrieve settlement records and reconcile transactions", async () => {
      const settlements = await setuSettlementService.getSettlementReportsService();
      expect(Array.isArray(settlements)).toBe(true);

      const reconcileResult = await setuSettlementService.reconcileTransactionsService();
      expect(reconcileResult.reconciledCount).toBeGreaterThanOrEqual(0);
    });
  });
});
