/**
 * OTP Real — placeholder for Twilio / MSG91 integration.
 * Replace stub implementation here when credentials are available.
 */
import type { OtpService } from "./otp.interface";

export const otpReal: OtpService = {
  async sendSms(phone: string, code: string) {
    // TODO: integrate MSG91 or Twilio
    throw new Error("Real OTP SMS not implemented yet. Set EXTERNAL_SERVICES_MODE=stub for development.");
  },

  async sendEmail(email: string, code: string) {
    // TODO: integrate SendGrid or AWS SES
    throw new Error("Real OTP email not implemented yet. Set EXTERNAL_SERVICES_MODE=stub for development.");
  },
};
