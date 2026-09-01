export interface InstantPayPanRequestOptions {
  pan: string;
  nameOnCard?: string;
  dateOfBirth?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface InstantPayPanResult {
  valid: boolean;
  pan: string;
  registeredName?: string;
  category?: string;
  status: string;
  rawResponse?: any;
}

export interface InstantPayGstinRequestOptions {
  gstNumber: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface InstantPayGstinResult {
  valid: boolean;
  gstin: string;
  legalName?: string;      // lgnm
  tradeName?: string;      // tradeNam
  status?: string;         // Active | Suspended | Canceled
  businessType?: string;   // Proprietorship | Pvt Ltd | LLP
  state?: string;          // stj
  address?: any;           // pradr.addr
  rawResponse?: any;
}

export interface InstantPayCinRequestOptions {
  cin: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface InstantPayCinResult {
  valid: boolean;
  cin: string;
  companyName?: string;
  companyStatus?: string;  // Active | Inactive | Strike Off
  companyType?: string;    // Private Limited | Public
  state?: string;          // RoC State
  registrationDate?: string;
  rawResponse?: any;
}

export interface InstantPayClient {
  verifyPan(panOrOptions: string | InstantPayPanRequestOptions): Promise<InstantPayPanResult>;
  verifyGstin(gstOrOptions: string | InstantPayGstinRequestOptions): Promise<InstantPayGstinResult>;
  verifyCin(cinOrOptions: string | InstantPayCinRequestOptions): Promise<InstantPayCinResult>;
}
