export interface BbpsBillerItem {
  billerId: string;
  billerName: string;
  category: string;
  logoUrl?: string;
  coverageArea?: string;
  paramsSchema: Array<{
    name: string;
    label: string;
    regex?: string;
    type?: string;
  }>;
}

export interface BbpsBillFetchResult {
  billerId: string;
  customerParams: Record<string, any>;
  billNumber?: string;
  billAmount: number;
  dueDate?: string;
  customerName?: string;
  rawResponse?: any;
}

export interface BbpsPaymentOrderResult {
  uniquePaymentRefID: string;
  setuPaymentLink: string;
  setuQrCode?: string;
  amount: number;
  status: string;
  rawResponse?: any;
}

export interface SetuBbpsClient {
  getBillerCategories(): Promise<string[]>;
  getBillers(category?: string, query?: string): Promise<BbpsBillerItem[]>;
  fetchBill(billerId: string, customerParams: Record<string, any>): Promise<BbpsBillFetchResult>;
  createPaymentOrder(params: {
    billerId: string;
    amount: number;
    userId: string;
    billFetchId?: string;
  }): Promise<BbpsPaymentOrderResult>;
}
