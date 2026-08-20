/**
 * OTP Stub — used when EXTERNAL_SERVICES_MODE=stub (default in dev/test).
 *
 * Bypass: any OTP code of "111111" will always pass verification.
 * In stub mode, the generated OTP is also logged to console so developers
 * can use it without SMS/email delivery.
 */
import type { OtpService } from "./otp.interface";

export const otpStub: OtpService = {
  async sendSms(phone: string, code: string) {
    console.log(`[OTP STUB] SMS to ${phone}: ${code}  (bypass: 111111)`);
  },

  async resendSms(phone: string, retryType: "text" | "voice" = "text") {
    console.log(`[OTP STUB] Resent SMS (${retryType}) to ${phone}  (bypass: 111111)`);
    return { success: true, message: "OTP resent successfully (stub mode)", requestId: `stub-retry-${Date.now()}` };
  },

  async sendEmail(email: string, code: string) {
    console.log(`[OTP STUB] Email to ${email}: ${code}  (bypass: 111111)`);
  },
};

