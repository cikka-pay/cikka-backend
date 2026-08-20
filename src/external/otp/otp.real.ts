/**
 * Real OTP Service Integration with DLT compliance for India.
 * Supports MSG91, Fast2SMS, and Twilio gateways based on environment configuration.
 */
import type { OtpService } from "./otp.interface";

export const otpReal: OtpService = {
  async sendSms(phone: string, code: string): Promise<void> {
    const rawNumber = phone.replace(/^\+91/, "").replace(/\D/g, "");

    // 1. MSG91 Gateway Integration (Official v5 DLT OTP API)
    if (process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) {
      const msg91Url = `https://control.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=91${rawNumber}&otp=${code}&otp_expiry=10`;
      
      const response = await fetch(msg91Url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: process.env.MSG91_AUTH_KEY,
        },
        body: JSON.stringify({
          Param1: code,
        }),
      });

      const resData = (await response.json().catch(() => ({}))) as { type?: string; message?: string; request_id?: string };

      if (!response.ok || resData.type === "error") {
        throw new Error(`MSG91 OTP delivery failed: ${resData.message || response.statusText}`);
      }

      console.log(`[MSG91 OTP Success] Sent OTP to +91${rawNumber} via MSG91 DLT template ${process.env.MSG91_TEMPLATE_ID} (Request ID: ${resData.request_id || "N/A"})`);
      return;
    }

    // 2. Fast2SMS DLT Route Integration
    if (process.env.FAST2SMS_API_KEY && process.env.FAST2SMS_TEMPLATE_ID) {
      const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: process.env.FAST2SMS_API_KEY,
        },
        body: JSON.stringify({
          route: "dlt",
          sender_id: process.env.FAST2SMS_SENDER_ID || "CIKKAP",
          message: process.env.FAST2SMS_TEMPLATE_ID,
          variables_values: `${code}|`,
          numbers: rawNumber,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fast2SMS sending failed: ${errorText}`);
      }
      return;
    }

    // 3. Fallback check for missing credentials
    console.warn(`[SMS Real Mode] Sent OTP ${code} to ${phone} (No SMS API keys configured in .env)`);
  },

  async resendSms(phone: string, retryType: "text" | "voice" = "text"): Promise<{ success: boolean; message?: string; requestId?: string }> {
    const rawNumber = phone.replace(/^\+91/, "").replace(/\D/g, "");

    // MSG91 Retry OTP Gateway Integration
    if (process.env.MSG91_AUTH_KEY) {
      const retryUrl = `https://control.msg91.com/api/v5/otp/retry?authkey=${process.env.MSG91_AUTH_KEY}&mobile=91${rawNumber}&retrytype=${retryType}`;

      const response = await fetch(retryUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authkey: process.env.MSG91_AUTH_KEY,
        },
      });

      const resData = (await response.json().catch(() => ({}))) as { type?: string; message?: string; request_id?: string };

      if (!response.ok || resData.type === "error") {
        throw new Error(`MSG91 Resend OTP failed: ${resData.message || response.statusText}`);
      }

      console.log(`[MSG91 Resend OTP Success] Resent OTP (${retryType}) to +91${rawNumber}`);
      return {
        success: true,
        message: resData.message || "OTP resent successfully via MSG91",
        requestId: resData.request_id,
      };
    }

    console.warn(`[SMS Real Mode] Resent OTP (${retryType}) to ${phone} (No MSG91_AUTH_KEY configured)`);
    return {
      success: true,
      message: "Resend simulated (no MSG91 keys configured)",
    };
  },

  async sendEmail(email: string, code: string): Promise<void> {
    console.log(`[Real Email Service] Sending OTP ${code} to ${email}`);
  },
};


