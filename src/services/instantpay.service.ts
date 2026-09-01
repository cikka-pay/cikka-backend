import { prisma } from "../config/prisma";
import { INSTANTPAY_ERRORS } from "../constants/errors";
import { instantpayClient } from "../external";

export interface VerifyPanDTO {
  userId?: string;
  pan: string;
}

export interface VerifyGstinDTO {
  sellerId?: string;
  userId?: string;
  gstNumber: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export interface VerifyCinDTO {
  sellerId?: string;
  userId?: string;
  cin: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
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

export async function verifyGstinService(dto: VerifyGstinDTO) {
  const { sellerId, userId, gstNumber, externalRef, latitude, longitude } = dto;

  if (!gstNumber) {
    throw new Error(INSTANTPAY_ERRORS.GSTIN_REQUIRED);
  }

  const formattedGstin = gstNumber.toUpperCase().trim();
  const gstinRegex = /^[0-9]{2}[A-Z0-9]{10,13}$/i;

  if (!gstinRegex.test(formattedGstin)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_GSTIN_FORMAT);
  }

  // Call InstantPay external GSTIN verification service
  const result = await instantpayClient.verifyGstin({
    gstNumber: formattedGstin,
    externalRef,
    latitude,
    longitude,
  });

  // Store verification record in Prisma DB for audit trail
  let dbRecord = null;
  try {
    if ((prisma as any).gstinVerificationRecord) {
      dbRecord = await (prisma as any).gstinVerificationRecord.create({
        data: {
          sellerId: sellerId || null,
          userId: userId || null,
          gstin: formattedGstin,
          legalName: result.legalName || null,
          tradeName: result.tradeName || null,
          status: result.status || (result.valid ? "Active" : "FAILED"),
          businessType: result.businessType || null,
          state: result.state || null,
          address: result.address || null,
          provider: "INSTANTPAY",
          rawResponse: result.rawResponse || null,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[InstantPay Service Warning] DB GSTIN logging skipped: ${err.message}`);
  }

  return {
    verificationId: dbRecord?.id || `v_gstin_${Date.now()}`,
    valid: result.valid,
    gstin: result.gstin,
    legalName: result.legalName || null,
    tradeName: result.tradeName || null,
    status: result.status || "Active",
    businessType: result.businessType || "Proprietorship",
    state: result.state || null,
    address: result.address || null,
  };
}

export async function verifyCinService(dto: VerifyCinDTO) {
  const { sellerId, userId, cin, externalRef, latitude, longitude } = dto;

  if (!cin) {
    throw new Error(INSTANTPAY_ERRORS.CIN_REQUIRED);
  }

  const formattedCin = cin.toUpperCase().trim();
  const cinRegex = /^[A-Z0-9]{21}$/i;

  if (!cinRegex.test(formattedCin)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_CIN_FORMAT);
  }

  // Call InstantPay external CIN verification service
  const result = await instantpayClient.verifyCin({
    cin: formattedCin,
    externalRef,
    latitude,
    longitude,
  });

  // Store verification record in Prisma DB for audit trail
  let dbRecord = null;
  try {
    if ((prisma as any).cinVerificationRecord) {
      dbRecord = await (prisma as any).cinVerificationRecord.create({
        data: {
          sellerId: sellerId || null,
          userId: userId || null,
          cin: formattedCin,
          companyName: result.companyName || null,
          companyStatus: result.companyStatus || (result.valid ? "Active" : "FAILED"),
          companyType: result.companyType || null,
          state: result.state || null,
          provider: "INSTANTPAY",
          rawResponse: result.rawResponse || null,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[InstantPay Service Warning] DB CIN logging skipped: ${err.message}`);
  }

  return {
    verificationId: dbRecord?.id || `v_cin_${Date.now()}`,
    valid: result.valid,
    cin: result.cin,
    companyName: result.companyName || null,
    companyStatus: result.companyStatus || "Active",
    companyType: result.companyType || "Private Limited",
    state: result.state || null,
    registrationDate: result.registrationDate || null,
  };
}
