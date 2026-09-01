import { InstantPayAadhaarRequestOptions, InstantPayAadhaarResult, InstantPayBankAccountRequestOptions, InstantPayBankAccountResult, InstantPayCinRequestOptions, InstantPayCinResult, InstantPayClient, InstantPayGstinRequestOptions, InstantPayGstinResult, InstantPayPanRequestOptions, InstantPayPanResult, InstantPayVpaRequestOptions, InstantPayVpaResult } from "./instantpay.interface";

export const instantpayStub: InstantPayClient = {
  async verifyPan(panOrOptions: string | InstantPayPanRequestOptions): Promise<InstantPayPanResult> {
    const pan = typeof panOrOptions === "string" ? panOrOptions : panOrOptions.pan;
    const formattedPan = pan.toUpperCase();
    console.log(`[INSTANTPAY STUB] Verification requested for PAN: ${formattedPan}`);

    if (formattedPan.endsWith("X")) {
      return {
        valid: false,
        pan: formattedPan,
        status: "INVALID",
        rawResponse: {
          statuscode: "ERR",
          status: "FAILED",
          message: "PAN not found in NSDL database",
        },
      };
    }

    const registeredName = typeof panOrOptions !== "string" && panOrOptions.nameOnCard ? panOrOptions.nameOnCard.toUpperCase() : "VEDANT VYAS";

    return {
      valid: true,
      pan: formattedPan,
      registeredName,
      category: "INDIVIDUAL",
      address: "123, Civil Lines, Jaipur, Rajasthan - 302001",
      status: "VALID",
      rawResponse: {
        statuscode: "TXN",
        status: "SUCCESS",
        data: {
          pan: formattedPan,
          name: registeredName,
          category: "INDIVIDUAL",
          status: "ACTIVE",
        },
      },
    };
  },

  async verifyGstin(gstOrOptions: string | InstantPayGstinRequestOptions): Promise<InstantPayGstinResult> {
    const gstin = typeof gstOrOptions === "string" ? gstOrOptions : gstOrOptions.gstNumber;
    const formattedGstin = gstin.toUpperCase().trim();
    console.log(`[INSTANTPAY STUB] Verification requested for GSTIN: ${formattedGstin}`);

    if (formattedGstin.endsWith("X")) {
      return {
        valid: false,
        gstin: formattedGstin,
        status: "Canceled",
        rawResponse: {
          statuscode: "ERR",
          status: "GSTIN Canceled or Invalid",
        },
      };
    }

    return {
      valid: true,
      gstin: formattedGstin,
      legalName: "CIKKA DIGITAL PRIVATE LIMITED",
      tradeName: "Cikka Pay",
      status: "Active",
      businessType: "Private Limited",
      state: "Gujarat",
      address: {
        bnm: "Cikka Heights",
        bno: "Plot 42",
        flno: "3rd Floor",
        st: "SG Highway",
        loc: "Bodakdev",
        dst: "Ahmedabad",
        city: "Ahmedabad",
        pncd: "380054",
        stcd: "Gujarat",
      },
      rawResponse: {
        statuscode: "TXN",
        status: "Transaction Successful",
        data: {
          gstDetails: {
            gstin: formattedGstin,
            lgnm: "CIKKA DIGITAL PRIVATE LIMITED",
            tradeNam: "Cikka Pay",
            sts: "Active",
            ctb: "Private Limited",
            stj: "Gujarat",
            pradr: {
              addr: {
                bnm: "Cikka Heights",
                bno: "Plot 42",
                flno: "3rd Floor",
                st: "SG Highway",
                loc: "Bodakdev",
                dst: "Ahmedabad",
                city: "Ahmedabad",
                pncd: "380054",
                stcd: "Gujarat",
              },
            },
          },
        },
      },
    };
  },

  async verifyCin(cinOrOptions: string | InstantPayCinRequestOptions): Promise<InstantPayCinResult> {
    const cin = typeof cinOrOptions === "string" ? cinOrOptions : cinOrOptions.cin;
    const formattedCin = cin.toUpperCase().trim();
    console.log(`[INSTANTPAY STUB] Verification requested for CIN: ${formattedCin}`);

    if (formattedCin.endsWith("X")) {
      return {
        valid: false,
        cin: formattedCin,
        companyStatus: "Strike Off",
        rawResponse: {
          statuscode: "ERR",
          status: "CIN Invalid or Struck Off",
        },
      };
    }

    return {
      valid: true,
      cin: formattedCin,
      companyName: "AURA VOGUE PRIVATE LIMITED",
      companyStatus: "Active",
      companyType: "Private Limited",
      state: "Maharashtra",
      registrationDate: "2019-06-15",
      rawResponse: {
        statuscode: "TXN",
        status: "Transaction Successful",
        data: {
          companyName: "AURA VOGUE PRIVATE LIMITED",
          companyStatus: "Active",
          companyType: "Private Limited",
          rocState: "Maharashtra",
          registrationDate: "2019-06-15",
        },
      },
    };
  },

  async verifyAadhaar(aadhaarOrOptions: string | InstantPayAadhaarRequestOptions): Promise<InstantPayAadhaarResult> {
    const options: InstantPayAadhaarRequestOptions =
      typeof aadhaarOrOptions === "string" ? { aadhaarNumber: aadhaarOrOptions } : aadhaarOrOptions;

    const aadhaarNumber = options.aadhaarNumber.trim();
    console.log(`[INSTANTPAY STUB] Aadhaar Verification requested for: ${aadhaarNumber}`);

    if (aadhaarNumber.endsWith("0")) {
      return {
        valid: false,
        aadhaarNumber,
        status: "INVALID",
        rawResponse: {
          statuscode: "ERR",
          status: "Aadhaar Number Invalid or Inactive",
        },
      };
    }

    return {
      valid: true,
      aadhaarNumber,
      aadhaarHolderName: options.name || "Sample Aadhaar Holder",
      state: "Uttar Pradesh",
      ageBand: "20-30",
      gender: "M",
      maskedMobile: "*******547",
      status: "VALID",
      rawResponse: {
        statuscode: "TXN",
        actcode: null,
        status: "Aadhaar Verification Successful",
        data: {
          poolReferenceId: `pool_${Date.now()}`,
          optional1Label: "Address",
          optional1: "Uttar Pradesh",
          optional2Label: "Age Band",
          optional2: "20-30",
          optional3Label: "Gender",
          optional3: "M",
          optional4Label: "Mobile Number",
          optional4: "*******547",
        },
        timestamp: "2026-08-31 21:20:00",
        environment: "SANDBOX",
      },
    };
  },

  async verifyVpa(vpaOrOptions: string | InstantPayVpaRequestOptions): Promise<InstantPayVpaResult> {
    const options: InstantPayVpaRequestOptions =
      typeof vpaOrOptions === "string" ? { vpa: vpaOrOptions } : vpaOrOptions;

    const vpa = options.vpa.trim();
    console.log(`[INSTANTPAY STUB] VPA Verification requested for: ${vpa}`);

    if (vpa.includes("invalid")) {
      return {
        valid: false,
        vpa,
        status: "INVALID",
        rawResponse: {
          statuscode: "ERR",
          status: "VPA handle not found or invalid",
        },
      };
    }

    return {
      valid: true,
      vpa,
      accountHolderName: options.name || "Instantpay India Ltd",
      ifsc: options.bankIfsc || "ICIC0000104",
      accountType: "SAVINGS",
      nameMatchPercent: 96,
      status: "VALID",
      rawResponse: {
        statuscode: "TXN",
        actcode: null,
        status: "Transaction Successful",
        data: {
          externalRef: options.externalRef || `ref_${Date.now()}`,
          poolReferenceId: `pool_${Date.now()}`,
          payee: {
            name: options.name || "Instantpay India Ltd",
            account: vpa,
            ifsc: options.bankIfsc || "ICIC0000104",
            accountType: "SAVINGS",
            nameMatchPercent: 96,
          },
          isCached: false,
          isPennyDrop: false,
        },
        timestamp: "2026-08-31 22:25:00",
        environment: "SANDBOX",
      },
    };
  },

  async verifyBankAccount(options: InstantPayBankAccountRequestOptions): Promise<InstantPayBankAccountResult> {
    const acc = options.accountNumber.trim();
    const ifsc = options.bankIfsc.trim().toUpperCase();

    console.log(`[INSTANTPAY STUB] Penny Drop Verification requested for Account: ${acc}, IFSC: ${ifsc}`);

    if (acc.endsWith("000")) {
      return {
        valid: false,
        accountNumber: acc,
        bankIfsc: ifsc,
        status: "INVALID",
        rawResponse: {
          statuscode: "ERR",
          status: "Bank Account verification failed or invalid details",
        },
      };
    }

    return {
      valid: true,
      accountNumber: acc,
      bankIfsc: ifsc,
      accountHolderName: options.name || "SHAHBAZ STORE",
      txnReferenceId: `tx_pd_${Date.now()}`,
      accountType: "SAVINGS",
      nameMatchPercent: 98,
      isPennyDrop: true,
      status: "VALID",
      rawResponse: {
        statuscode: "TXN",
        actcode: null,
        status: "Transaction Successful",
        data: {
          externalRef: options.externalRef || `ref_${Date.now()}`,
          poolReferenceId: `pool_${Date.now()}`,
          txnValue: "1.00",
          txnReferenceId: `tx_pd_${Date.now()}`,
          payee: {
            name: options.name || "SHAHBAZ STORE",
            account: acc,
            ifsc,
            accountType: "SAVINGS",
            nameMatchPercent: 98,
          },
          isCached: false,
          isPennyDrop: true,
        },
        timestamp: "2026-08-31 22:37:00",
        environment: "SANDBOX",
      },
    };
  },
};
