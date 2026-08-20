import { describe, it, expect } from "vitest";
import { otpStub } from "../../external/otp/otp.stub";
import { sendUserOtpService, resendUserOtpService, verifyUserOtpService } from "../../services/user-auth.service";

describe("MSG91 & OTP Unit Tests", () => {
  it("should format and handle stub resendSms cleanly", async () => {
    const resend = await otpStub.resendSms("+919876543210", "text");
    expect(resend.success).toBe(true);
    expect(resend.requestId).toBeDefined();
  });

  it("should allow resending OTP for mobile user auth", async () => {
    const testPhone = "9876543210";
    const initial = await sendUserOtpService(testPhone);
    expect(initial.otp).toBeDefined();

    const resent = await resendUserOtpService(testPhone, "text");
    expect(resent.message).toBeDefined();

    // Verify OTP still matches and completes verification
    const verify = await verifyUserOtpService(testPhone, resent.otp);
    expect(verify.token).toBeDefined();
    expect(verify.user.phone).toBe("+919876543210");
  });
});
