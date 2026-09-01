import { InstantPayClient, InstantPayPanResult, InstantPayPanRequestOptions, InstantPayGstinResult, InstantPayGstinRequestOptions, InstantPayCinResult, InstantPayCinRequestOptions } from "./instantpay.interface";

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
};
