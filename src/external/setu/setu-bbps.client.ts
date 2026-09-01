import { config } from "../../config/env";
import { BBPS_ERRORS } from "../../constants/errors";
import type {
  SetuBbpsService,
  BbpsCategory,
  BbpsBiller,
  FetchBillParams,
  BillDetails,
  InitiatePaymentParams,
  BbpsPaymentResult,
  CheckStatusResult,
} from "./setu-bbps.interface";

// ============================================================
// STUB DATA (Used in dev / test mode)
// ============================================================
const MOCK_CATEGORIES: BbpsCategory[] = [
  { id: "cat-elec", name: "Electricity", code: "ELECTRICITY" },
  { id: "cat-mobile", name: "Mobile Postpaid", code: "MOBILE_POSTPAID" },
  { id: "cat-dth", name: "DTH", code: "DTH" },
  { id: "cat-water", name: "Water", code: "WATER" },
  { id: "cat-gas", name: "Piped Gas", code: "GAS" },
  { id: "cat-fastag", name: "FASTag", code: "FASTAG" },
];

const MOCK_BILLERS: BbpsBiller[] = [
  {
    id: "biller-bescom",
    name: "BESCOM - Bengaluru Electricity",
    category: "ELECTRICITY",
    billerId: "BESCOM000KAR01",
    coverage: "KARNATAKA",
    inputParams: [
      {
        paramName: "Consumer Number / Account ID",
        paramId: "consumer_number",
        dataType: "ALPHANUMERIC",
        isMandatory: true,
        minLength: 5,
        maxLength: 15,
      },
    ],
  },
  {
    id: "biller-tata-power",
    name: "Tata Power - Mumbai",
    category: "ELECTRICITY",
    billerId: "TATAPWR00MUM01",
    coverage: "MAHARASHTRA",
    inputParams: [
      {
        paramName: "Consumer Number",
        paramId: "consumer_number",
        dataType: "NUMERIC",
        isMandatory: true,
        minLength: 8,
        maxLength: 12,
      },
    ],
  },
  {
    id: "biller-jio-postpaid",
    name: "Jio Mobile Postpaid",
    category: "MOBILE_POSTPAID",
    billerId: "JIOPST000IND01",
    coverage: "NATIONAL",
    inputParams: [
      {
        paramName: "Mobile Number",
        paramId: "mobile_number",
        dataType: "NUMERIC",
        isMandatory: true,
        minLength: 10,
        maxLength: 10,
        regex: "^[6-9]\\d{9}$",
      },
    ],
  },
  {
    id: "biller-tata-play",
    name: "Tata Play DTH",
    category: "DTH",
    billerId: "TATAPLY00IND01",
    coverage: "NATIONAL",
    inputParams: [
      {
        paramName: "Subscriber ID / Mobile Number",
        paramId: "subscriber_id",
        dataType: "NUMERIC",
        isMandatory: true,
        minLength: 10,
        maxLength: 11,
      },
    ],
  },
];

// ============================================================
// STUB IMPLEMENTATION
// ============================================================
export const setuBbpsStub: SetuBbpsService = {
  async getCategories(): Promise<BbpsCategory[]> {
    return MOCK_CATEGORIES;
  },

  async getBillers(category?: string): Promise<BbpsBiller[]> {
    if (!category) return MOCK_BILLERS;
    const catUpper = category.toUpperCase();
    return MOCK_BILLERS.filter((b) => b.category.toUpperCase() === catUpper);
  },

  async getBillerDetails(billerId: string): Promise<BbpsBiller> {
    const biller = MOCK_BILLERS.find((b) => b.billerId === billerId || b.id === billerId);
    if (!biller) {
      throw new Error(BBPS_ERRORS.BILLER_NOT_FOUND);
    }
    return biller;
  },

  async fetchBill(params: FetchBillParams): Promise<BillDetails> {
    const biller = MOCK_BILLERS.find((b) => b.billerId === params.billerId || b.id === params.billerId);
    if (!biller) {
      throw new Error(BBPS_ERRORS.BILLER_NOT_FOUND);
    }

    const paramVal = Object.values(params.customerParams)[0] || "1234567890";
    const now = new Date();
    const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    return {
      setuBillId: `setu-bill-${Date.now()}`,
      billerId: biller.billerId,
      customerName: "Cikka Valued Customer",
      billAmount: 1450.0,
      dueDate,
      billNumber: `BILL-${paramVal.slice(-4)}-2026`,
      billDate: now.toISOString().split("T")[0],
      exactness: "EXACT",
    };
  },

  async payBill(params: InitiatePaymentParams): Promise<BbpsPaymentResult> {
    const setuPaymentId = `setu-pay-${Date.now()}`;
    const bbpsRefNo = `BBPS${Date.now()}`;

    return {
      refID: params.refID,
      setuPaymentId,
      status: "SUCCESS",
      bbpsRefNo,
      amount: params.amount,
      message: "Bill payment processed successfully via Setu BBPS",
      receiptUrl: `https://bbps.setu.co/receipts/${setuPaymentId}`,
    };
  },

  async checkStatus(refID: string): Promise<CheckStatusResult> {
    return {
      refID,
      status: "SUCCESS",
      amount: 1450.0,
      bbpsRefNo: `BBPS-${refID}`,
      rawPayload: { mode: "stub", refID },
    };
  },
};

// ============================================================
// REAL IMPLEMENTATION (Calls Setu REST Gateway)
// ============================================================
export const setuBbpsReal: SetuBbpsService = {
  async getCategories(): Promise<BbpsCategory[]> {
    const response = await fetch(`${config.setuBbpsBaseUrl}/billers/categories`, {
      method: "GET",
      headers: getSetuHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Setu API HTTP Error: ${response.statusText}`);
    }
    const data: any = await response.json();
    return data.data || [];
  },

  async getBillers(category?: string): Promise<BbpsBiller[]> {
    const query = category ? `?category=${encodeURIComponent(category)}` : "";
    const response = await fetch(`${config.setuBbpsBaseUrl}/billers${query}`, {
      method: "GET",
      headers: getSetuHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Setu API HTTP Error: ${response.statusText}`);
    }
    const data: any = await response.json();
    return data.data || [];
  },

  async getBillerDetails(billerId: string): Promise<BbpsBiller> {
    const response = await fetch(`${config.setuBbpsBaseUrl}/billers/${billerId}`, {
      method: "GET",
      headers: getSetuHeaders(),
    });
    if (!response.ok) {
      throw new Error(BBPS_ERRORS.BILLER_NOT_FOUND);
    }
    const data: any = await response.json();
    return data.data;
  },

  async fetchBill(params: FetchBillParams): Promise<BillDetails> {
    const response = await fetch(`${config.setuBbpsBaseUrl}/bill/fetch`, {
      method: "POST",
      headers: getSetuHeaders(),
      body: JSON.stringify({
        billerId: params.billerId,
        customerParams: params.customerParams,
      }),
    });
    if (!response.ok) {
      throw new Error(BBPS_ERRORS.BILL_FETCH_FAILED);
    }
    const data: any = await response.json();
    return data.data;
  },

  async payBill(params: InitiatePaymentParams): Promise<BbpsPaymentResult> {
    const response = await fetch(`${config.setuBbpsBaseUrl}/bill/pay`, {
      method: "POST",
      headers: getSetuHeaders(),
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      throw new Error(BBPS_ERRORS.PAYMENT_FAILED);
    }
    const data: any = await response.json();
    return data.data;
  },

  async checkStatus(refID: string): Promise<CheckStatusResult> {
    const response = await fetch(`${config.setuBbpsBaseUrl}/bill/status/${refID}`, {
      method: "GET",
      headers: getSetuHeaders(),
    });
    if (!response.ok) {
      throw new Error(BBPS_ERRORS.TRANSACTION_NOT_FOUND);
    }
    const data: any = await response.json();
    return data.data;
  },
};

function getSetuHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Setu-Product-Instance-ID": config.setuBbpsProductInstanceId,
    "X-Setu-ClientID": config.setuBbpsSchemeId,
    "X-Setu-Secret": config.setuBbpsSecret,
  };
}

export const setuBbpsService: SetuBbpsService =
  config.externalServicesMode === "real" ? setuBbpsReal : setuBbpsStub;
