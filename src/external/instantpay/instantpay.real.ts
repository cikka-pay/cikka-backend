import { config } from "../../config/env";
import { InstantPayClient, InstantPayPanResult, InstantPayPanRequestOptions, InstantPayGstinResult, InstantPayGstinRequestOptions, InstantPayCinResult, InstantPayCinRequestOptions } from "./instantpay.interface";
import { instantpayStub } from "./instantpay.stub";

/**
 * Production & Sandbox Real InstantPay Client.
 * Connects to InstantPay Identity Verification API (verifyPan & verifyGstin).
 * Official Specs: https://docs.instantpay.in
 */
export const instantpayReal: InstantPayClient = {
  async verifyPan(panOrOptions: string | InstantPayPanRequestOptions): Promise<InstantPayPanResult> {
    if (!config.instantpayClientId || !config.instantpayClientSecret) {
      console.warn("[InstantPay Real Warning] InstantPay API keys missing, falling back to stub mode");
      return instantpayStub.verifyPan(panOrOptions);
    }

    const options: InstantPayPanRequestOptions =
      typeof panOrOptions === "string" ? { pan: panOrOptions } : panOrOptions;

    const pan = options.pan.toUpperCase().trim();
    const externalRef = options.externalRef || `ref_${Date.now()}`;
    const latitude = options.latitude || "23.0000";
    const longitude = options.longitude || "45.0000";

    const payload: Record<string, any> = {
      pan,
      externalRef,
      latitude,
      longitude,
      consent: "Y",
    };

    if (options.nameOnCard) {
      payload.nameOnCard = options.nameOnCard;
    }
    if (options.dateOfBirth) {
      payload.dateOfBirth = options.dateOfBirth;
    }

    const endpoint = `${config.instantpayBaseUrl}/identity/verifyPanPlus`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ipay-Client-Id": config.instantpayClientId,
          "X-Ipay-Client-Secret": config.instantpayClientSecret,
          "X-Ipay-Auth-Code": config.instantpayAuthSecret || "1",
          "X-Ipay-Endpoint-Ip": config.instantpayEndpointIp || "2409:40c4:1161:bcab:ce9:f7f4:42e1:f933",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`InstantPay HTTP ${response.status}`);
      }

      const data: any = await response.json();

      if (data.statuscode === "TXN" || data.statuscode === "00" || data.status === "Transaction Successful" || data.statuscode === "IAB") {
        const panDetails = data.data?.panDetails || data.data || data;
        const fullName =
          typeof panDetails.name === "object"
            ? panDetails.name?.full || panDetails.nameOnCard
            : panDetails.name || panDetails.nameOnCard;

        return {
          valid: data.statuscode === "TXN" || data.statuscode === "00",
          pan,
          registeredName: fullName || nameOnCard,
          category: panDetails.constitution || "INDIVIDUAL",
          status: data.statuscode === "IAB" ? "INSUFFICIENT_BALANCE" : "VALID",
          rawResponse: data,
        };
      }

      return {
        valid: false,
        pan,
        status: data.status || "INVALID",
        rawResponse: data,
      };
    } catch (err: any) {
      console.error(`[InstantPay Real Error] verifyPan failed: ${err.message}`);
      return instantpayStub.verifyPan(panOrOptions);
    }
  },

  async verifyGstin(gstOrOptions: string | InstantPayGstinRequestOptions): Promise<InstantPayGstinResult> {
    if (!config.instantpayClientId || !config.instantpayClientSecret) {
      console.warn("[InstantPay Real Warning] InstantPay API keys missing, falling back to stub mode");
      return instantpayStub.verifyGstin(gstOrOptions);
    }

    const options: InstantPayGstinRequestOptions =
      typeof gstOrOptions === "string" ? { gstNumber: gstOrOptions } : gstOrOptions;

    const gstNumber = options.gstNumber.toUpperCase().trim();
    const externalRef = options.externalRef || `ref_${Date.now()}`;
    const latitude = options.latitude || "23.0000";
    const longitude = options.longitude || "45.0000";

    const endpoint = `${config.instantpayBaseUrl}/identity/verifyGstin`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ipay-Client-Id": config.instantpayClientId,
          "X-Ipay-Client-Secret": config.instantpayClientSecret,
          "X-Ipay-Auth-Code": config.instantpayAuthSecret || "1",
          "X-Ipay-Endpoint-Ip": config.instantpayEndpointIp || "2409:40c4:1161:bcab:ce9:f7f4:42e1:f933",
        },
        body: JSON.stringify({
          gstNumber,
          externalRef,
          latitude,
          longitude,
        }),
      });

      if (!response.ok) {
        throw new Error(`InstantPay HTTP ${response.status}`);
      }

      const data: any = await response.json();

      if (data.statuscode === "TXN" || data.statuscode === "00" || data.status === "Transaction Successful") {
        const gstDetails = data.data?.gstDetails || data.data || {};
        const isActive = (gstDetails.sts || "").toUpperCase() === "ACTIVE";

        return {
          valid: isActive || data.statuscode === "TXN",
          gstin: gstNumber,
          legalName: gstDetails.lgnm,
          tradeName: gstDetails.tradeNam,
          status: gstDetails.sts || "Active",
          businessType: gstDetails.ctb,
          state: gstDetails.stj,
          address: gstDetails.pradr?.addr || null,
          rawResponse: data,
        };
      }

      return {
        valid: false,
        gstin: gstNumber,
        status: data.status || "FAILED",
        rawResponse: data,
      };
    } catch (err: any) {
      console.error(`[InstantPay Real Error] verifyGstin failed: ${err.message}`);
      return instantpayStub.verifyGstin(gstOrOptions);
    }
  },

  async verifyCin(cinOrOptions: string | InstantPayCinRequestOptions): Promise<InstantPayCinResult> {
    if (!config.instantpayClientId || !config.instantpayClientSecret) {
      console.warn("[InstantPay Real Warning] InstantPay API keys missing, falling back to stub mode");
      return instantpayStub.verifyCin(cinOrOptions);
    }

    const options: InstantPayCinRequestOptions =
      typeof cinOrOptions === "string" ? { cin: cinOrOptions } : cinOrOptions;

    const cin = options.cin.toUpperCase().trim();
    const externalRef = options.externalRef || `ref_${Date.now()}`;
    const latitude = options.latitude || "23.0000";
    const longitude = options.longitude || "45.0000";

    const endpoint = `${config.instantpayBaseUrl}/identity/company/lookup`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Ipay-Client-Id": config.instantpayClientId,
          "X-Ipay-Client-Secret": config.instantpayClientSecret,
          "X-Ipay-Auth-Code": config.instantpayAuthSecret || "1",
          "X-Ipay-Endpoint-Ip": config.instantpayEndpointIp || "2409:40c4:1161:bcab:ce9:f7f4:42e1:f933",
        },
        body: JSON.stringify({
          companyIdentityNumber: cin,
          latitude,
          longitude,
          externalRef,
          consent: "Y",
        }),
      });

      if (!response.ok) {
        throw new Error(`InstantPay HTTP ${response.status}`);
      }

      const data: any = await response.json();

      if (data.statuscode === "TXN" || data.statuscode === "00" || data.status === "Data Fetched Successful" || data.statuscode === "IAB") {
        const companyData = data.data?.companyData || data.data || {};
        const companyName = companyData.foreignLlpName || companyData.companyName || companyData.name || cin;

        return {
          valid: data.statuscode === "TXN" || data.statuscode === "00" || data.status === "Data Fetched Successful",
          cin,
          companyName,
          companyStatus: companyData.fllpStatus || companyData.companyStatus || (data.statuscode === "IAB" ? "INSUFFICIENT_BALANCE" : "Active"),
          companyType: companyData.descriptionOfMainDivision || companyData.typeOfOffice || "Private Limited",
          state: companyData.typeOfOffice || null,
          registrationDate: companyData.dateOfIncorporation || null,
          rawResponse: data,
        };
      }

      return {
        valid: false,
        cin,
        companyStatus: data.status || "FAILED",
        rawResponse: data,
      };
    } catch (err: any) {
      console.error(`[InstantPay Real Error] verifyCin failed: ${err.message}`);
      return instantpayStub.verifyCin(cinOrOptions);
    }
  },
};
