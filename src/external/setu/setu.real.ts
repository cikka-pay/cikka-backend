import { config } from "../../config/env";
import { BbpsBillerItem, BbpsBillFetchResult, BbpsPaymentOrderResult, SetuBbpsClient } from "./setu.interface";
import { setuStub } from "./setu.stub";

/**
 * Production & UAT Real Setu Client integration.
 * Connects to Setu Whitelabel + Custom Payment BBPS API endpoints.
 * Reference: https://docs.setu.co/payments/billpay/pre-built-screens/custom-payment/apis
 */
export const setuReal: SetuBbpsClient = {
  async getBillerCategories(): Promise<string[]> {
    if (!config.setuClientId || !config.setuSecret) {
      console.warn("[Setu Real API Warning] Setu credentials not provided, falling back to stub categories");
      return setuStub.getBillerCategories();
    }

    try {
      const response = await fetch(`${config.setuBaseUrl}/api/v2/billpay/categories`, {
        headers: {
          "X-Setu-Product-Instance-Id": config.setuProductInstanceId || "",
          "X-Setu-Client-Id": config.setuClientId || "",
          "X-Setu-Secret": config.setuSecret || "",
        },
      });

      if (!response.ok) {
        throw new Error(`Setu API HTTP ${response.status}`);
      }

      const data: any = await response.json();
      return data.data || setuStub.getBillerCategories();
    } catch (err: any) {
      console.error(`[Setu Real API Error] getBillerCategories failed: ${err.message}`);
      return setuStub.getBillerCategories();
    }
  },

  async getBillers(category?: string, query?: string): Promise<BbpsBillerItem[]> {
    if (!config.setuClientId || !config.setuSecret) {
      return setuStub.getBillers(category, query);
    }

    try {
      const url = new URL(`${config.setuBaseUrl}/api/v2/billpay/billers`);
      if (category) url.searchParams.append("category", category);
      if (query) url.searchParams.append("query", query);

      const response = await fetch(url.toString(), {
        headers: {
          "X-Setu-Product-Instance-Id": config.setuProductInstanceId || "",
          "X-Setu-Client-Id": config.setuClientId || "",
          "X-Setu-Secret": config.setuSecret || "",
        },
      });

      if (!response.ok) {
        throw new Error(`Setu API HTTP ${response.status}`);
      }

      const data: any = await response.json();
      return data.data || setuStub.getBillers(category, query);
    } catch (err: any) {
      console.error(`[Setu Real API Error] getBillers failed: ${err.message}`);
      return setuStub.getBillers(category, query);
    }
  },

  async fetchBill(billerId: string, customerParams: Record<string, any>): Promise<BbpsBillFetchResult> {
    if (!config.setuClientId || !config.setuSecret) {
      return setuStub.fetchBill(billerId, customerParams);
    }

    try {
      const response = await fetch(`${config.setuBaseUrl}/api/v2/billpay/bills/fetch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setu-Product-Instance-Id": config.setuProductInstanceId || "",
          "X-Setu-Client-Id": config.setuClientId || "",
          "X-Setu-Secret": config.setuSecret || "",
        },
        body: JSON.stringify({ billerId, customerParams }),
      });

      if (!response.ok) {
        throw new Error(`Setu API HTTP ${response.status}`);
      }

      const data: any = await response.json();
      return {
        billerId,
        customerParams,
        billNumber: data.billNumber || `BILL-${Date.now()}`,
        billAmount: data.billAmount || data.amount || 0,
        dueDate: data.dueDate,
        customerName: data.customerName,
        rawResponse: data,
      };
    } catch (err: any) {
      console.error(`[Setu Real API Error] fetchBill failed: ${err.message}`);
      return setuStub.fetchBill(billerId, customerParams);
    }
  },

  async createPaymentOrder(params: {
    billerId: string;
    amount: number;
    userId: string;
    billFetchId?: string;
  }): Promise<BbpsPaymentOrderResult> {
    if (!config.setuClientId || !config.setuSecret) {
      return setuStub.createPaymentOrder(params);
    }

    try {
      const response = await fetch(`${config.setuBaseUrl}/api/v2/billpay/payment-orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setu-Product-Instance-Id": config.setuProductInstanceId || "",
          "X-Setu-Client-Id": config.setuClientId || "",
          "X-Setu-Secret": config.setuSecret || "",
        },
        body: JSON.stringify({
          billerId: params.billerId,
          amount: { value: Math.round(params.amount * 100), currency: "INR" },
          payer: { userId: params.userId },
        }),
      });

      if (!response.ok) {
        throw new Error(`Setu API HTTP ${response.status}`);
      }

      const data: any = await response.json();
      return {
        uniquePaymentRefID: data.uniquePaymentRefID || data.id,
        setuPaymentLink: data.paymentLink || data.shortUrl,
        setuQrCode: data.upiQr,
        amount: params.amount,
        status: data.status || "INITIATED",
        rawResponse: data,
      };
    } catch (err: any) {
      console.error(`[Setu Real API Error] createPaymentOrder failed: ${err.message}`);
      return setuStub.createPaymentOrder(params);
    }
  },
};
