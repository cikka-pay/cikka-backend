import crypto from "crypto";
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

  // DEV BYPASS RULE for AAAAA1111A
  if (formattedPan === "AAAAA1111A") {
    console.log("==================================================");
    console.log("⚡ [DEV BYPASS] InstantPay PAN Verification Bypassed!");
    console.log(`PAN: ${formattedPan}`);
    console.log("Registered Name: DEV BYPASS USER");
    console.log("Category: INDIVIDUAL");
    console.log("User Gender: M");
    console.log("User DOB: XX7");
    console.log("Status: VALID (Dev Bypass)");
    console.log("==================================================");

    return {
      verificationId: `v_pan_bypass_${Date.now()}`,
      valid: true,
      pan: "AAAAA1111A",
      registeredName: "DEV BYPASS USER",
      category: "INDIVIDUAL",
      userGender: "M",
      userDob: "XX7",
      address: "Dev Bypass Address, India",
      status: "VALID",
      isDevBypass: true,
    };
  }

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

  if (!panRegex.test(formattedPan)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_PAN_FORMAT);
  }

  // Call InstantPay external service
  const result = await instantpayClient.verifyPan(formattedPan);

  console.log("==================================================");
  console.log(`🔍 [InstantPay PAN V1 Verification Result]`);
  console.log(`PAN: ${formattedPan}`);
  console.log(`Valid: ${result.valid}`);
  console.log(`Registered Name: ${result.registeredName || "N/A"}`);
  console.log(`Category: ${result.category || "INDIVIDUAL"}`);
  console.log(`User Gender: ${result.userGender || "N/A"}`);
  console.log(`User DOB: ${result.userDob || "N/A"}`);
  console.log(`Status: ${result.status}`);
  if (result.address) console.log(`Address: ${result.address}`);
  console.log("==================================================");

  // Store verification record in Prisma DB for audit trail
  let dbRecord = null;
  try {
    if (prisma.panVerificationRecord) {
      dbRecord = await prisma.panVerificationRecord.create({
        data: {
          userId: userId || null,
          pan: formattedPan,
          registeredName: result.registeredName || null,
          category: result.category || null,
          status: result.status,
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
    userGender: result.userGender || null,
    userDob: result.userDob || null,
    address: result.address || null,
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
    if (prisma.gstinVerificationRecord) {
      dbRecord = await prisma.gstinVerificationRecord.create({
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
    if (prisma.cinVerificationRecord) {
      dbRecord = await prisma.cinVerificationRecord.create({
        data: {
          sellerId: sellerId || null,
          userId: userId || null,
          cin: formattedCin,
          companyName: result.companyName || null,
          companyStatus: result.companyStatus || (result.valid ? "Active" : "FAILED"),
          companyType: result.companyType || null,
          state: result.state || null,
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

export interface VerifyAadhaarDTO {
  aadhaarNumber: string;
  name?: string;
  sellerId?: string;
  userId?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export async function verifyAadhaarService(dto: VerifyAadhaarDTO) {
  const { aadhaarNumber, name, sellerId, userId, externalRef, latitude, longitude } = dto;

  if (!aadhaarNumber) {
    throw new Error(INSTANTPAY_ERRORS.AADHAAR_REQUIRED);
  }

  const formattedAadhaar = aadhaarNumber.trim();
  const aadhaarRegex = /^[2-9]{1}[0-9]{11}$/;

  if (!aadhaarRegex.test(formattedAadhaar)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_AADHAAR_FORMAT);
  }

  // Call InstantPay external Aadhaar verification service
  const result = await instantpayClient.verifyAadhaar({
    aadhaarNumber: formattedAadhaar,
    name,
    externalRef,
    latitude,
    longitude,
  });

  // Store verification record in Prisma DB for audit trail
  let dbRecord = null;
  try {
    if (prisma.aadhaarVerificationRecord) {
      dbRecord = await prisma.aadhaarVerificationRecord.create({
        data: {
          sellerId: sellerId || null,
          userId: userId || null,
          aadhaarNumber: formattedAadhaar.replace(/(\d{4})\d{4}(\d{4})/, "$1XXXX$2"),
          aadhaarHolderName: result.aadhaarHolderName || name || null,
          state: result.state || null,
          ageBand: result.ageBand || null,
          gender: result.gender || null,
          maskedMobile: result.maskedMobile || null,
          status: result.status || (result.valid ? "VALID" : "INVALID"),
          valid: result.valid,
          rawResponse: result.rawResponse || null,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[InstantPay Service Warning] DB Aadhaar logging skipped: ${err.message}`);
  }

  return {
    verificationId: dbRecord?.id || `v_aadhaar_${Date.now()}`,
    valid: result.valid,
    aadhaarNumber: result.aadhaarNumber,
    aadhaarHolderName: result.aadhaarHolderName || name || null,
    state: result.state || null,
    ageBand: result.ageBand || null,
    gender: result.gender || null,
    maskedMobile: result.maskedMobile || null,
    status: result.status || "VALID",
  };
}

export interface VerifyVpaDTO {
  vpa: string;
  name?: string;
  bankIfsc?: string;
  sellerId?: string;
  userId?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export async function verifyVpaService(dto: VerifyVpaDTO) {
  const { vpa, name, bankIfsc, sellerId, userId, externalRef, latitude, longitude } = dto;

  if (!vpa) {
    throw new Error(INSTANTPAY_ERRORS.VPA_REQUIRED);
  }

  const formattedVpa = vpa.trim();
  const vpaRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

  if (!vpaRegex.test(formattedVpa)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_VPA_FORMAT);
  }

  // Call InstantPay external VPA verification service
  const result = await instantpayClient.verifyVpa({
    vpa: formattedVpa,
    name,
    bankIfsc,
    externalRef,
    latitude,
    longitude,
  });

  // Store verification record in Prisma DB for audit trail
  let dbRecord = null;
  try {
    if (prisma.vpaVerificationRecord) {
      dbRecord = await prisma.vpaVerificationRecord.create({
        data: {
          sellerId: sellerId || null,
          userId: userId || null,
          vpa: formattedVpa,
          accountHolderName: result.accountHolderName || name || null,
          ifsc: result.ifsc || bankIfsc || null,
          accountType: result.accountType || "SAVINGS",
          nameMatchPercent: result.nameMatchPercent || 0,
          status: result.status || (result.valid ? "VALID" : "INVALID"),
          valid: result.valid,
          rawResponse: result.rawResponse || null,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[InstantPay Service Warning] DB VPA logging skipped: ${err.message}`);
  }

  return {
    verificationId: dbRecord?.id || `v_vpa_${Date.now()}`,
    valid: result.valid,
    vpa: result.vpa,
    accountHolderName: result.accountHolderName || name || null,
    ifsc: result.ifsc || bankIfsc || null,
    accountType: result.accountType || "SAVINGS",
    nameMatchPercent: result.nameMatchPercent || 0,
    status: result.status || "VALID",
  };
}

export interface VerifyBankAccountDTO {
  accountNumber: string;
  bankIfsc: string;
  name?: string;
  sellerId?: string;
  userId?: string;
  externalRef?: string;
  latitude?: string;
  longitude?: string;
}

export async function verifyBankAccountService(dto: VerifyBankAccountDTO) {
  const { accountNumber, bankIfsc, name, sellerId, userId, externalRef, latitude, longitude } = dto;

  if (!accountNumber) {
    throw new Error(INSTANTPAY_ERRORS.ACCOUNT_NUMBER_REQUIRED);
  }
  if (!bankIfsc) {
    throw new Error(INSTANTPAY_ERRORS.IFSC_REQUIRED);
  }

  const formattedAccount = accountNumber.trim();
  const formattedIfsc = bankIfsc.trim().toUpperCase();

  const accountRegex = /^\d{9,18}$/;
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

  if (!accountRegex.test(formattedAccount)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_ACCOUNT_FORMAT);
  }
  if (!ifscRegex.test(formattedIfsc)) {
    throw new Error(INSTANTPAY_ERRORS.INVALID_IFSC_FORMAT);
  }

  // Call InstantPay external Penny Drop verification service
  const result = await instantpayClient.verifyBankAccount({
    accountNumber: formattedAccount,
    bankIfsc: formattedIfsc,
    name,
    externalRef,
    latitude,
    longitude,
  });

  // Store verification record in Prisma DB for audit trail (masked for privacy)
  let dbRecord = null;
  const maskedAccountNumber = formattedAccount.replace(/^(\d+)(\d{4})$/, (_, p1, p2) => "X".repeat(p1.length) + p2);
  const accountNumberHash = crypto.createHash("sha256").update(formattedAccount).digest("hex");

  try {
    if (prisma.bankAccountVerificationRecord) {
      dbRecord = await prisma.bankAccountVerificationRecord.create({
        data: {
          sellerId: sellerId || null,
          userId: userId || null,
          maskedAccountNumber,
          accountNumberHash,
          bankIfsc: formattedIfsc,
          accountHolderName: result.accountHolderName || name || null,
          txnReferenceId: result.txnReferenceId || null,
          accountType: result.accountType || "SAVINGS",
          nameMatchPercent: result.nameMatchPercent || 0,
          isPennyDrop: true,
          status: result.status || (result.valid ? "VALID" : "INVALID"),
          valid: result.valid,
          rawResponse: result.rawResponse || null,
        },
      });
    }
  } catch (err: any) {
    console.warn(`[InstantPay Service Warning] DB Bank Account logging skipped: ${err.message}`);
  }

  return {
    verificationId: dbRecord?.id || `v_bank_${Date.now()}`,
    valid: result.valid,
    accountNumber: result.accountNumber,
    bankIfsc: result.bankIfsc,
    accountHolderName: result.accountHolderName || name || null,
    txnReferenceId: result.txnReferenceId || null,
    accountType: result.accountType || "SAVINGS",
    nameMatchPercent: result.nameMatchPercent || 0,
    isPennyDrop: true,
    status: result.status || "VALID",
  };
}
