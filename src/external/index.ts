/**
 * External services factory.
 * Selects stub vs real implementations based on EXTERNAL_SERVICES_MODE env var.
 * Default: "stub" (safe for dev and test).
 */
import { otpStub } from "./otp/otp.stub";
import { otpReal } from "./otp/otp.real";
import { kybStub } from "./kyb/kyb.stub";
import { kybReal } from "./kyb/kyb.real";
import { storageStub } from "./storage/storage.stub";
import { storageRailway } from "./storage/storage.railway";
import { setuBillpayReal } from "./setu/billpay.client";
import { setuBillpayStub } from "./setu/billpay.stub";
import { instantpayStub } from "./instantpay/instantpay.stub";
import { instantpayReal } from "./instantpay/instantpay.real";
import { config } from "../config/env";
import type { OtpService } from "./otp/otp.interface";
import type { KybService } from "./kyb/kyb.interface";
import type { StorageService } from "./storage/storage.interface";
import type { SetuBillpayClient } from "./setu/billpay.interface";
import type { InstantPayClient } from "./instantpay/instantpay.interface";

const mode = config.externalServicesMode;

if (mode !== "stub" && mode !== "real") {
  throw new Error(`Invalid EXTERNAL_SERVICES_MODE="${mode}". Must be "stub" or "real".`);
}

export const otpService: OtpService = mode === "real" ? otpReal : otpStub;
export const kybService: KybService = mode === "real" ? kybReal : kybStub;

// Storage is chosen independently of EXTERNAL_SERVICES_MODE (see config.storageProvider):
// Railway Bucket in production, local disk for dev / tests.
const storageProviders: Record<string, StorageService> = {
  railway: storageRailway,
  local: storageStub,
};
const storageProvider = config.storageProvider;
if (!storageProviders[storageProvider]) {
  throw new Error(`Invalid STORAGE_PROVIDER="${storageProvider}". Must be "railway" or "local".`);
}
if (storageProvider === "local" && config.isProduction) {
  console.warn(
    "[External Services] WARNING: STORAGE_PROVIDER=local in production — uploads are written to the " +
      "container disk and lost on every redeploy. Connect a Railway Bucket (BUCKET, ACCESS_KEY_ID, ...)."
  );
}
export const storageService: StorageService = storageProviders[storageProvider];
// Setu BillPay pre-built screens (spec 002). Real mode never falls back to the stub.
export const setuBillpayClient: SetuBillpayClient = mode === "real" ? setuBillpayReal : setuBillpayStub;
export const instantpayClient: InstantPayClient = mode === "real" ? instantpayReal : instantpayStub;

console.log(`[External Services] Mode: ${mode}, storage: ${storageProvider}`);

