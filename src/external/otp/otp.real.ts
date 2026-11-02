/**
 * Real OTP Service Integration with DLT compliance for India.
 * Supports MSG91, Fast2SMS, and Twilio gateways based on environment configuration.
 */
import type { OtpService, OtpTemplateType } from "./otp.interface";

/**
 * Airtel DLT Registered Templates (Telemarketer: Walkover Web Solutions / MSG91 TM-ID 1302157225275643280)
 */
export const AIRTEL_DLT_TEMPLATES = {
  app_signup: {
    templateName: "Cikka_App_Signup_Otp",
    dltTemplateId: "1077409590010034474",
    header: "CKACLB",
  },
  app_login: {
    templateName: "Cikka_App_Login_Otp",
    dltTemplateId: "107529390010098378",
    header: "CKACLB",
  },
  seller_signup: {
    templateName: "Cikka_Seller_Signup_Otp",
    dltTemplateId: "107303880010137288",
    header: "CKASLR",
  },
  seller_login: {
    templateName: "Cikka_Seller_Login_Otp",
    dltTemplateId: "107286450010325323",
    header: "CKASLR",
  },
  team_invite: {
    templateName: "TeamMember_AdultInvite_Otp",
    dltTemplateId: "1077099760010302811",
    header: "CKASLR",
  },
} as const;

export const otpReal: OtpService = {
  async sendSms(phone: string, code: string, templateType: OtpTemplateType = "app_login"): Promise<void> {
    const rawNumber = phone.replace(/^\+91/, "").replace(/\D/g, "");

    // Dev bypass: Absolutely no request to MSG91 or any gateway
    if (rawNumber === "1111111111" || rawNumber === "11111111111" || rawNumber.endsWith("1111111111")) {
      console.log(`[MSG91 BYPASS] Intercepted bypass number ${rawNumber}. ZERO HTTP requests made to MSG91.`);
      return;
    }

    const dltConfig = AIRTEL_DLT_TEMPLATES[templateType] || AIRTEL_DLT_TEMPLATES.app_login;

    // Resolve template ID: specific env var -> general env var -> DLT Template ID
    const envTemplateId =
      (templateType === "app_signup" && process.env.MSG91_TEMPLATE_ID_APP_SIGNUP) ||
      (templateType === "app_login" && process.env.MSG91_TEMPLATE_ID_APP_LOGIN) ||
      (templateType === "seller_signup" && process.env.MSG91_TEMPLATE_ID_SELLER_SIGNUP) ||
      (templateType === "seller_login" && process.env.MSG91_TEMPLATE_ID_SELLER_LOGIN) ||
      (templateType === "team_invite" && process.env.MSG91_TEMPLATE_ID_TEAM_INVITE) ||
      process.env.MSG91_TEMPLATE_ID ||
      dltConfig.dltTemplateId;

    const senderHeader = process.env.MSG91_SENDER_ID || dltConfig.header;

    // 1. MSG91 Gateway Integration (Official v5 DLT OTP API)
    if (process.env.MSG91_AUTH_KEY) {
      const sendViaMsg91 = async (tplId: string) => {
        const msg91Url = `https://control.msg91.com/api/v5/otp?template_id=${tplId}&mobile=91${rawNumber}&otp=${code}&otp_expiry=10`;
        const response = await fetch(msg91Url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authkey: process.env.MSG91_AUTH_KEY!,
          },
          body: JSON.stringify({
            Param1: code,
            num: code,
            otp: code,
          }),
        });

        const resData = (await response.json().catch(() => ({}))) as { type?: string; message?: string; request_id?: string };
        if (!response.ok || resData.type === "error") {
          throw new Error(`MSG91 OTP delivery failed: ${resData.message || response.statusText}`);
        }
        return resData;
      };

      try {
        const resData = await sendViaMsg91(envTemplateId);
        console.log(`[MSG91 OTP Success] Sent OTP to +91${rawNumber} via ${dltConfig.templateName} (Template ID: ${envTemplateId}) (Request ID: ${resData.request_id || "N/A"})`);
        return;
      } catch (err: any) {
        // Fallback to default approved template if specific template fails
        const fallbackId = process.env.MSG91_TEMPLATE_ID || "6ad258ba61d7b186370091e2";
        if (envTemplateId !== fallbackId) {
          console.warn(`[MSG91 Warning] Template ${envTemplateId} failed (${err.message}). Retrying with approved fallback template ${fallbackId}...`);
          const resData = await sendViaMsg91(fallbackId);
          console.log(`[MSG91 OTP Fallback Success] Sent OTP to +91${rawNumber} via fallback template ${fallbackId} (Request ID: ${resData.request_id || "N/A"})`);
          return;
        }
        throw err;
      }
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
    console.log(`
==================================================
  📱 CIKKA DEV OTP GENERATED
  Phone : ${phone}
  OTP   : ${code}
==================================================
`);
  },

  async resendSms(phone: string, retryType: "text" | "voice" = "text"): Promise<{ success: boolean; message?: string; requestId?: string }> {
    const rawNumber = phone.replace(/^\+91/, "").replace(/\D/g, "");

    // Dev bypass: Absolutely no resend request to MSG91 or any gateway
    if (rawNumber === "1111111111" || rawNumber === "11111111111" || rawNumber.endsWith("1111111111")) {
      console.log(`[MSG91 BYPASS] Intercepted resend for bypass number ${rawNumber}. ZERO HTTP requests made to MSG91.`);
      return { success: true, message: "Dev bypass OTP resend simulated (No MSG91 call)" };
    }

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
    console.log(`
==================================================
  📧 CIKKA EMAIL OTP GENERATED
  Email : ${email}
  OTP   : ${code}
==================================================
`);

    const { sendOtpEmail } = await import("../../utils/resend");
    const result = await sendOtpEmail({
      to: email,
      code,
      purpose: "account verification",
    });

    if (result.success) {
      console.log(`[Resend OTP Email Success] Dispatched OTP ${code} to ${email} (Resend ID: ${result.id})`);
    } else {
      console.error(`[Resend OTP Email Error] Failed to send OTP to ${email}:`, result.error);
    }
  },
};



