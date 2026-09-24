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
import { storageGcs } from "./storage/storage.gcs";
import { setuBbpsStub, setuBbpsReal } from "./setu/setu-bbps.client";
import { setuStub } from "./setu/setu.stub";
import { setuReal } from "./setu/setu.real";
import { instantpayStub } from "./instantpay/instantpay.stub";
import { instantpayReal } from "./instantpay/instantpay.real";
import type { OtpService } from "./otp/otp.interface";
import type { KybService } from "./kyb/kyb.interface";
import type { StorageService } from "./storage/storage.interface";
import type { SetuBbpsService } from "./setu/setu-bbps.interface";
import type { SetuBbpsClient } from "./setu/setu.interface";
import type { InstantPayClient } from "./instantpay/instantpay.interface";

const mode = process.env.EXTERNAL_SERVICES_MODE ?? "stub";

if (mode !== "stub" && mode !== "real") {
  throw new Error(`Invalid EXTERNAL_SERVICES_MODE="${mode}". Must be "stub" or "real".`);
}

export const otpService: OtpService = mode === "real" ? otpReal : otpStub;
export const kybService: KybService = mode === "real" ? kybReal : kybStub;
export const storageService: StorageService = mode === "real" ? storageGcs : storageStub;
export const setuBbpsService: SetuBbpsService = mode === "real" ? setuBbpsReal : setuBbpsStub;
export const setuClient: SetuBbpsClient = mode === "real" ? setuReal : setuStub;
export const instantpayClient: InstantPayClient = mode === "real" ? instantpayReal : instantpayStub;

console.log(`[External Services] Mode: ${mode}`);

