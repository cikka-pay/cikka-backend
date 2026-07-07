// OTP Service Interface
// Real implementation will call Twilio/MSG91 (SMS) and SendGrid (email).

export interface OtpService {
  /**
   * Send a 6-digit OTP via SMS to the given phone number.
   * Format: +91XXXXXXXXXX
   */
  sendSms(phone: string, code: string): Promise<void>;

  /**
   * Send a 6-digit OTP via email.
   */
  sendEmail(email: string, code: string): Promise<void>;
}
