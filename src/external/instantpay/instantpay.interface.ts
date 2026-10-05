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
  address?: string;
  userGender?: string;
  userDob?: string;
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

export interface InstantPayAadhaarRequestOptions {
  aadhaarNumber: string;
  encryptedAadhaar?: string;
  name?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface InstantPayAadhaarResult {
  valid: boolean;
  aadhaarNumber: string;
  aadhaarHolderName?: string;
  state?: string;
  ageBand?: string;
  gender?: string;
  maskedMobile?: string;
  status?: string;
  rawResponse?: any;
}

export interface InstantPayVpaRequestOptions {
  vpa: string;
  name?: string;
  bankIfsc?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface InstantPayVpaResult {
  valid: boolean;
  vpa: string;
  accountHolderName?: string;
  ifsc?: string;
  accountType?: string;
  nameMatchPercent?: number;
  status?: string;
  rawResponse?: any;
}

export interface InstantPayBankAccountRequestOptions {
  accountNumber: string;
  bankIfsc: string;
  name?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface InstantPayBankAccountResult {
  valid: boolean;
  accountNumber: string;
  bankIfsc: string;
  accountHolderName?: string;
  txnReferenceId?: string;
  accountType?: string;
  nameMatchPercent?: number;
  isPennyDrop?: boolean;
  status?: string;
  rawResponse?: any;
}

export interface InstantPayClient {
  verifyPan(panOrOptions: string | InstantPayPanRequestOptions): Promise<InstantPayPanResult>;
  verifyGstin(gstOrOptions: string | InstantPayGstinRequestOptions): Promise<InstantPayGstinResult>;
  verifyCin(cinOrOptions: string | InstantPayCinRequestOptions): Promise<InstantPayCinResult>;
  verifyAadhaar(aadhaarOrOptions: string | InstantPayAadhaarRequestOptions): Promise<InstantPayAadhaarResult>;
  verifyVpa(vpaOrOptions: string | InstantPayVpaRequestOptions): Promise<InstantPayVpaResult>;
  verifyBankAccount(options: InstantPayBankAccountRequestOptions): Promise<InstantPayBankAccountResult>;
}
