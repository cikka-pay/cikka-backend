import { prisma } from "../config/prisma";
import { kybService } from "../external";
import { generateApplicationId, getNextApplicationSequence } from "./auth.service";

/**
 * Ensures the onboarding record exists for a seller.
 */
export async function getOrCreateOnboarding(sellerId: string) {
  let record = await prisma.sellerOnboarding.findUnique({
    where: { sellerId },
  });
  if (!record) {
    record = await prisma.sellerOnboarding.create({
      data: { sellerId },
    });
  }
  return record;
}

/**
 * Verifies GST and saves the result to the onboarding record.
 */
export async function verifyGst(sellerId: string, gstNumber: string) {
  const result = await kybService.verifyGst(gstNumber);
  await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      gstNumber,
      gstVerified: result.valid,
      gstData: result as any,
    },
  });
  return result;
}

/**
 * Verifies PAN and saves the result to the onboarding record.
 */
export async function verifyPan(sellerId: string, panNumber: string) {
  const result = await kybService.verifyPan(panNumber);
  await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      panNumber,
      panVerified: result.valid,
      panData: result as any,
    },
  });
  return result;
}

/**
 * Verifies CIN and saves the result to the onboarding record.
 */
export async function verifyCin(sellerId: string, cinNumber: string) {
  const result = await kybService.verifyCin(cinNumber);
  await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      cinNumber,
      cinVerified: result.valid,
      cinData: result as any,
    },
  });
  return result;
}

/**
 * Sends Aadhaar OTP via KYB service.
 */
export async function sendAadhaarOtp(aadhaar: string, mobile: string) {
  return await kybService.sendAadhaarOtp(aadhaar, mobile);
}

/**
 * Verifies Aadhaar OTP via KYB service and updates record.
 */
export async function verifyAadhaarOtp(sellerId: string, referenceId: string, otp: string) {
  const result = await kybService.verifyAadhaarOtp(referenceId, otp);
  if (result.valid) {
    await prisma.sellerOnboarding.update({
      where: { sellerId },
      data: { signatoryAadhaarVerified: true },
    });
  }
  return result;
}

/**
 * Verifies Bank Account (penny drop) and updates record.
 */
export async function verifyBank(sellerId: string, ifsc: string, accountNumber: string) {
  const result = await kybService.verifyBank(ifsc, accountNumber);
  if (result.valid) {
    await prisma.sellerOnboarding.update({
      where: { sellerId },
      data: {
        bankIfsc: ifsc,
        bankAccountNumber: accountNumber,
        bankVerified: true,
        bankData: result as any,
      },
    });
  }
  return result;
}

/**
 * Submits the completed onboarding application.
 */
export async function submitOnboarding(sellerId: string) {
  const seq = await getNextApplicationSequence();
  const applicationId = generateApplicationId(seq);

  const onboarding = await prisma.sellerOnboarding.update({
    where: { sellerId },
    data: {
      applicationId,
      submittedAt: new Date(),
    },
  });

  await prisma.seller.update({
    where: { id: sellerId },
    data: { onboardingStatus: "SUBMITTED" },
  });

  return onboarding;
}
