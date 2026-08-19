export interface BbpsCategory {
  id: string;
  name: string;
  code: string;
  iconUrl?: string;
}

export interface BbpsBillerParam {
  paramName: string;
  paramId: string;
  dataType: "NUMERIC" | "ALPHANUMERIC";
  isMandatory: boolean;
  minLength?: number;
  maxLength?: number;
  regex?: string;
}

export interface BbpsBiller {
  id: string;
  name: string;
  category: string;
  billerId: string;
  coverage?: string;
  inputParams: BbpsBillerParam[];
}

export interface FetchBillParams {
  billerId: string;
  customerParams: Record<string, string>;
}

export interface BillDetails {
  setuBillId: string;
  billerId: string;
  customerName: string;
  billAmount: number;
  dueDate: string;
  billNumber: string;
  billDate: string;
  exactness: "EXACT" | "EXACT_AND_ABOVE" | "ANY";
}

export interface InitiatePaymentParams {
  refID: string;
  billerId: string;
  amount: number;
  customerParams: Record<string, string>;
  setuBillId?: string;
  paymentMode?: string;
}

export interface BbpsPaymentResult {
  refID: string;
  setuPaymentId: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  bbpsRefNo?: string;
  amount: number;
  message?: string;
  receiptUrl?: string;
}

export interface CheckStatusResult {
  refID: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  amount: number;
  bbpsRefNo?: string;
  rawPayload?: any;
}

export interface SetuBbpsService {
  getCategories(): Promise<BbpsCategory[]>;
  getBillers(category?: string): Promise<BbpsBiller[]>;
  getBillerDetails(billerId: string): Promise<BbpsBiller>;
  fetchBill(params: FetchBillParams): Promise<BillDetails>;
  payBill(params: InitiatePaymentParams): Promise<BbpsPaymentResult>;
  checkStatus(refID: string): Promise<CheckStatusResult>;
}
