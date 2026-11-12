import { prisma } from "../config/prisma";
import { setuBillpayClient } from "../external";
import { SetuBillpayError } from "../external/setu/billpay.interface";
import { AUTH_ERRORS, BILLPAY_ERRORS } from "../constants/errors";
import type { CreateBillpaySessionBody } from "../validations/billpay.validation";

export interface BillpaySessionResult {
  link: string;
  sessionId: string;
}

function httpError(message: string, status: number, code: string, extra?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

/** "+91 98765-43210" / "919876543210" / "9876543210" → "9876543210"; null if not 10 digits. */
export function toTenDigitMobile(phone: string): string | null {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Creates a one-time Setu BillPay link for the calling user (spec 002, step 2).
 * Uses the user's verified phone and `custID = user.id`. Setu failures become a 502 —
 * never a fake link.
 */
export async function createBillpaySessionService(
  userId: string,
  body: CreateBillpaySessionBody = {}
): Promise<BillpaySessionResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, phoneVerified: true },
  });
  if (!user) {
    throw httpError(AUTH_ERRORS.USER_NOT_FOUND, 404, "USER_NOT_FOUND");
  }
  if (!user.phoneVerified) {
    throw httpError(BILLPAY_ERRORS.PHONE_NOT_VERIFIED, 400, "PHONE_NOT_VERIFIED");
  }
  const mobileNumber = toTenDigitMobile(user.phone);
  if (!mobileNumber) {
    throw httpError(BILLPAY_ERRORS.INVALID_PHONE, 400, "INVALID_PHONE");
  }

  try {
    const { link, sessionId } = await setuBillpayClient.createLink({
      mobileNumber,
      custID: user.id,
      categoryName: body.categoryName,
      billerId: body.billerId,
      redirectTo: body.redirectTo,
    });
    return { link, sessionId };
  } catch (err) {
    if (err instanceof SetuBillpayError) {
      console.error(
        `[BillPay] Setu create link failed for user ${user.id}: status=${err.status} code=${err.code} traceId=${err.traceId ?? "-"} ${err.message}`
      );
      throw httpError(BILLPAY_ERRORS.SETU_UNAVAILABLE, 502, "SETU_UNAVAILABLE", { traceId: err.traceId });
    }
    throw err;
  }
}
