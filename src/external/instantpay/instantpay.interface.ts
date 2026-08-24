export interface InstantPayPanResult {
  valid: boolean;
  pan: string;
  registeredName?: string;
  category?: string;
  status: "VALID" | "INVALID" | "INACTIVE" | "FAILED";
  rawResponse?: any;
}

export interface InstantPayClient {
  verifyPan(pan: string): Promise<InstantPayPanResult>;
}
