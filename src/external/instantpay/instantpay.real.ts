import { config } from "../../config/env";
import { InstantPayClient, InstantPayPanResult } from "./instantpay.interface";
import { instantpayStub } from "./instantpay.stub";

/**
 * Production & Sandbox Real InstantPay Client.
 * Connects to InstantPay Identity Verification API.
 * Official Specs: https://docs.instantpay.in
 */
export const instantpayReal: InstantPayClient = {
  async verifyPan(pan: string): Promise<InstantPayPanResult> {
    if (!config.instantpayClientId || !config.instantpayClientSecret) {
      console.warn("[InstantPay Real Warning] InstantPay API keys missing, falling back to stub mode");
      return instantpayStub.verifyPan(pan);
    }

    try {
      const response = await fetch(`${config.instantpayBaseUrl}/identity/pan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ipay-Client-Id": config.instantpayClientId,
          "X-Ipay-Client-Secret": config.instantpayClientSecret,
          "X-Ipay-Auth-Secret": config.instantpayAuthSecret || "",
          "X-Ipay-Endpoint-Ip": config.instantpayEndpointIp || "127.0.0.1",
        },
        body: JSON.stringify({
          pan,
          consent: "Y",
          consentText: "I consent to verification of my PAN via InstantPay API.",
        }),
      });

      if (!response.ok) {
        throw new Error(`InstantPay HTTP ${response.status}`);
      }

      const data: any = await response.json();

      if (data.statuscode === "TXN" || data.statuscode === "00" || data.status === "SUCCESS") {
        const payloadData = data.data || data;
        return {
          valid: true,
          pan: pan.toUpperCase(),
          registeredName: payloadData.name || payloadData.registeredName,
          category: payloadData.category || "INDIVIDUAL",
          status: "VALID",
          rawResponse: data,
        };
      }

      return {
        valid: false,
        pan: pan.toUpperCase(),
        status: "INVALID",
        rawResponse: data,
      };
    } catch (err: any) {
      console.error(`[InstantPay Real Error] verifyPan failed: ${err.message}`);
      return instantpayStub.verifyPan(pan);
    }
  },
};
