import { BbpsBillerItem, BbpsBillFetchResult, BbpsPaymentOrderResult, SetuBbpsClient } from "./setu.interface";

const MOCK_BILLERS: BbpsBillerItem[] = [
  {
    billerId: "BESCOM000KAR01",
    billerName: "Bangalore Electricity Supply Company (BESCOM)",
    category: "ELECTRICITY",
    logoUrl: "https://ui-avatars.com/api/?name=BESCOM&background=0284c7&color=fff",
    coverageArea: "Karnataka",
    paramsSchema: [
      { name: "accountNumber", label: "Account Number / Account ID", regex: "^[0-9]{10}$", type: "text" },
    ],
  },
  {
    billerId: "TATAELECT00001",
    billerName: "Tata Power - Mumbai Electricity",
    category: "ELECTRICITY",
    logoUrl: "https://ui-avatars.com/api/?name=TATA&background=2563eb&color=fff",
    coverageArea: "Maharashtra",
    paramsSchema: [
      { name: "consumerNumber", label: "Consumer Number", regex: "^[0-9]{12}$", type: "text" },
    ],
  },
  {
    billerId: "HDFCCARD00001",
    billerName: "HDFC Credit Card Bill Pay",
    category: "CREDIT_CARD",
    logoUrl: "https://ui-avatars.com/api/?name=HDFC&background=dc2626&color=fff",
    coverageArea: "Pan India",
    paramsSchema: [
      { name: "cardNumber", label: "Last 4 Digits of Credit Card", regex: "^[0-9]{4}$", type: "numeric" },
      { name: "mobileNumber", label: "Registered Mobile Number", regex: "^[6-9][0-9]{9}$", type: "text" },
    ],
  },
  {
    billerId: "AIRTELPOST0001",
    billerName: "Airtel Mobile Postpaid",
    category: "MOBILE_POSTPAID",
    logoUrl: "https://ui-avatars.com/api/?name=Airtel&background=ef4444&color=fff",
    coverageArea: "Pan India",
    paramsSchema: [
      { name: "mobileNumber", label: "Mobile Number", regex: "^[6-9][0-9]{9}$", type: "text" },
    ],
  },
  {
    billerId: "TATAPLAY000001",
    billerName: "Tata Play DTH",
    category: "DTH",
    logoUrl: "https://ui-avatars.com/api/?name=TataPlay&background=9333ea&color=fff",
    coverageArea: "Pan India",
    paramsSchema: [
      { name: "subscriberId", label: "Subscriber ID / Registered Mobile No.", regex: "^[0-9]{10}$", type: "text" },
    ],
  },
];

export const setuStub: SetuBbpsClient = {
  async getBillerCategories(): Promise<string[]> {
    return ["ELECTRICITY", "CREDIT_CARD", "MOBILE_POSTPAID", "DTH", "WATER", "GAS", "BROADBAND"];
  },

  async getBillers(category?: string, query?: string): Promise<BbpsBillerItem[]> {
    let result = [...MOCK_BILLERS];
    if (category) {
      result = result.filter((b) => b.category.toUpperCase() === category.toUpperCase());
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter((b) => b.billerName.toLowerCase().includes(q) || b.billerId.toLowerCase().includes(q));
    }
    return result;
  },

  async fetchBill(billerId: string, customerParams: Record<string, any>): Promise<BbpsBillFetchResult> {
    const biller = MOCK_BILLERS.find((b) => b.billerId === billerId) || MOCK_BILLERS[0];
    const mockAmount = 1450.0;
    const dueDateStr = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    return {
      billerId: biller.billerId,
      customerParams,
      billNumber: `BILL-${Date.now()}`,
      billAmount: mockAmount,
      dueDate: dueDateStr,
      customerName: "Sujal P",
      rawResponse: {
        status: "SUCCESS",
        billerName: biller.billerName,
        customerParams,
      },
    };
  },

  async createPaymentOrder(params: {
    billerId: string;
    amount: number;
    userId: string;
    billFetchId?: string;
  }): Promise<BbpsPaymentOrderResult> {
    const refId = `SETU_BBPS_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      uniquePaymentRefID: refId,
      setuPaymentLink: `https://uat.setu.co/pay/${refId}`,
      setuQrCode: `upi://pay?pa=setu.bbps@icici&pn=CikkaPay&tr=${refId}&am=${params.amount}&cu=INR`,
      amount: params.amount,
      status: "INITIATED",
      rawResponse: {
        setuRefId: refId,
        paymentMode: "Whitelabel + Custom Payment (BBPS)",
        uic: "SETU-BBPS-UAT",
      },
    };
  },
};
