/**
 * External services factory.
 * Selects stub vs real implementations based on EXTERNAL_SERVICES_MODE env var.
 * Default: "stub" (safe for dev and test).
 */
import { otpStub } from "./otp/otp.stub";
import { otpReal } from "./otp/otp.real";
import { kybStub } from "./kyb/kyb.stub";
import { kybReal } from "./kyb/kyb.real";
import { storageStub, storageReal } from "./storage/storage";
import type { OtpService } from "./otp/otp.interface";
import type { KybService } from "./kyb/kyb.interface";
import type { StorageService } from "./storage/storage";

const mode = process.env.EXTERNAL_SERVICES_MODE ?? "stub";

if (mode !== "stub" && mode !== "real") {
  throw new Error(`Invalid EXTERNAL_SERVICES_MODE="${mode}". Must be "stub" or "real".`);
}

export const otpService: OtpService = mode === "real" ? otpReal : otpStub;
export const kybService: KybService = mode === "real" ? kybReal : kybStub;
export const storageService: StorageService = mode === "real" ? storageReal : storageStub;

console.log(`[External Services] Mode: ${mode}`);
