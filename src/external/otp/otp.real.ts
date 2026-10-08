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

    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey || apiKey === "re_123456789" || apiKey.trim() === "") {
      console.log(`[Resend OTP Mock Mode] Skipping live API call (No RESEND_API_KEY configured)`);
      return;
    }

    const ownerEmail = process.env.RESEND_TEST_RECIPIENT || "vedantvyas79@gmail.com";
    let targetTo = email;

    if (fromEmail.includes("resend.dev") && targetTo.toLowerCase() !== ownerEmail.toLowerCase()) {
      console.log(`[Resend OTP Test Mode] Redirecting OTP recipient ${targetTo} -> ${ownerEmail} (Resend test domain requirement)`);
      targetTo = ownerEmail;
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Cikka Auth <${fromEmail}>`,
          to: [targetTo],
          subject: `Your Cikka Verification Code: ${code}`,
          html: `

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #07040b; color: #ffffff; border-radius: 16px; border: 1px solid #27272a;">
  <div style="color: #c084fc; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 12px;">CIKKA SECURITY</div>
  <h2 style="color: #ffffff; font-size: 20px; font-weight: 700; margin: 0 0 8px 0;">Verify Your Email Address</h2>
  <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5; margin: 0 0 24px 0;">Use the following 6-digit verification code to complete your setup:</p>
  <div style="background: #181226; border: 1px solid #7e22ce; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #e9d5ff; padding: 18px; text-align: center; border-radius: 12px; margin-bottom: 24px;">
    ${code}
  </div>
  <p style="color: #71717a; font-size: 12px; margin: 0;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
</div>
          `.trim(),
        }),
      });

      const resData = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (response.ok) {
        console.log(`[Resend OTP Email Success] Dispatched OTP ${code} to ${email} (Resend ID: ${resData.id})`);
      } else {
        console.error(`[Resend OTP Email Error] Delivery failed:`, resData);
      }
    } catch (err) {
      console.error(`[Resend OTP Exception] Failed to send email to ${email}:`, err);
    }
  },
};



