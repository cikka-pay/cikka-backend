// OTP Service Interface
// Real implementation will call Twilio/MSG91 (SMS) and SendGrid (email).

export type OtpTemplateType =
  | "app_signup"
  | "app_login"
  | "seller_signup"
  | "seller_login"
  | "team_invite";

export interface OtpService {
  /**
   * Send an OTP via SMS to the given phone number.
   * Format: +91XXXXXXXXXX
   * Optional templateType selects the corresponding Airtel DLT / MSG91 template.
   */
  sendSms(phone: string, code: string, templateType?: OtpTemplateType): Promise<void>;

  /**
   * Resend an OTP via SMS (or voice call retry) to the given phone number using MSG91 Retry API.
   */
  resendSms(phone: string, retryType?: "text" | "voice"): Promise<{ success: boolean; message?: string; requestId?: string }>;

  /**
   * Send an OTP via email.
   */
  sendEmail(email: string, code: string): Promise<void>;
}

