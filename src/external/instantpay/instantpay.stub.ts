import { InstantPayClient, InstantPayPanResult } from "./instantpay.interface";

export const instantpayStub: InstantPayClient = {
  async verifyPan(pan: string): Promise<InstantPayPanResult> {
    const formattedPan = pan.toUpperCase();
    console.log(`[INSTANTPAY STUB] Verification requested for PAN: ${formattedPan}`);

    // Test rejection rule: PAN ending with 'X' is treated as invalid for testing edge cases
    if (formattedPan.endsWith("X")) {
      return {
        valid: false,
        pan: formattedPan,
        status: "INVALID",
        rawResponse: {
          statuscode: "ERR",
          status: "FAILED",
          message: "PAN not found in NSDL database",
        },
      };
    }

    return {
      valid: true,
      pan: formattedPan,
      registeredName: "SUJAL P",
      category: "INDIVIDUAL",
      status: "VALID",
      rawResponse: {
        statuscode: "TXN",
        status: "SUCCESS",
        data: {
          pan: formattedPan,
          name: "SUJAL P",
          category: "INDIVIDUAL",
          status: "ACTIVE",
        },
      },
    };
  },
};
