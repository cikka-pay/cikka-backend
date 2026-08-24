import { prisma } from "../config/prisma";
import { INSTANTPAY_ERRORS } from "../constants/errors";
import { instantpayClient } from "../external";

export interface VerifyPanDTO {
  userId?: string;
  pan: string;
}

export async function verifyPanService(dto: VerifyPanDTO) {
  const { userId, pan } = dto;

  if (!pan) {
    throw new Error(INSTANTPAY_ERRORS.PAN_REQUIRED);
  }

  const formattedPan = pan.toUpperCase().trim();
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

  if (!panRegex.test(formattedPan)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_PAN_FORMAT);
  }

  // Call InstantPay external service
  const result = await instantpayClient.verifyPan(formattedPan);

  // Store verification record in Prisma DB for audit trail
  let dbRecord = null;
  try {
    if ((prisma as any).panVerificationRecord) {
      dbRecord = await (prisma as any).panVerificationRecord.create({
        data: {
          userId: userId || null,
          pan: formattedPan,
          registeredName: result.registeredName || null,
          category: result.category || null,
          status: result.status,
          provider: "INSTANTPAY",
          rawResponse: result.rawResponse || null,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[InstantPay Service Warning] DB logging skipped: ${err.message}`);
  }

  return {
    verificationId: dbRecord?.id || `v_pan_${Date.now()}`,
    valid: result.valid,
    pan: result.pan,
    registeredName: result.registeredName || null,
    category: result.category || "INDIVIDUAL",
    status: result.status,
  };
}
