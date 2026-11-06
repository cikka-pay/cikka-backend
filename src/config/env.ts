import dotenv from "dotenv";

dotenv.config();

const NODE_ENV = (process.env.NODE_ENV || "development").trim();
// "production" is the only value Railway/Docker set, but accept common spellings so a typo
// can never silently switch on the dev bypasses (mock signatures, stub payments, ...).
const IS_PRODUCTION = ["production", "prod"].includes(NODE_ENV.toLowerCase());

// Stub mode fakes OTP / KYC / Setu / InstantPay / Razorpay. It must never run in production:
// default to "real" there and refuse to start if someone explicitly asks for "stub".
const EXTERNAL_SERVICES_MODE = process.env.EXTERNAL_SERVICES_MODE || (IS_PRODUCTION ? "real" : "stub");
if (IS_PRODUCTION && EXTERNAL_SERVICES_MODE !== "real") {
  throw new Error(
    `EXTERNAL_SERVICES_MODE="${EXTERNAL_SERVICES_MODE}" is not allowed with NODE_ENV=${NODE_ENV}. Use "real" in production.`
  );
}

export const config = {
  env: NODE_ENV,
  isProduction: IS_PRODUCTION,
  isDevelopment: NODE_ENV === "development" || (NODE_ENV as string) === "dev",
  isTest: NODE_ENV === "test",

  port: parseInt(process.env.PORT || "4000", 10),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  sellerPortalUrl: (process.env.SELLER_PORTAL_URL || process.env.FRONTEND_URL || "https://seller.cikka.club").replace(/\/+$/, ""),

  // Auth secrets
  jwtSecret: process.env.JWT_SECRET || "dev_secret",
  jwtSellerSecret: process.env.JWT_SELLER_SECRET || process.env.JWT_SECRET || "dev_seller_secret",
  jwtUserSecret: process.env.JWT_USER_SECRET || process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET || "dev_user_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  // External service modes
  externalServicesMode: EXTERNAL_SERVICES_MODE,
  isRealExternalServices: EXTERNAL_SERVICES_MODE === "real",

  // Setu BillPay pre-built screens (spec 002). Hosts: sandbox https://sandbox-coudc.setu.co,
  // QA https://qa-coudc.setu.co, prod https://coudc.setu.co.
  setuBillpayBaseUrl: (process.env.SETU_BILLPAY_BASE_URL || "https://sandbox-coudc.setu.co").replace(/\/+$/, ""),
  setuBillpayClientId: process.env.SETU_BILLPAY_CLIENT_ID,
  setuBillpaySecret: process.env.SETU_BILLPAY_SECRET,
  setuBillpayPartnerId: process.env.SETU_BILLPAY_PARTNER_ID,
  setuBillpayOrgId: process.env.SETU_BILLPAY_ORG_ID,
  setuBillpayWebhookApiKey: process.env.SETU_BILLPAY_WEBHOOK_API_KEY,

  // InstantPay Identity & Verification Config
  instantpayBaseUrl: process.env.INSTANTPAY_BASE_URL || "https://sandbox.instantpay.in/v1",
  instantpayClientId: process.env.INSTANTPAY_CLIENT_ID,
  instantpayClientSecret: process.env.INSTANTPAY_CLIENT_SECRET,
  instantpayAuthSecret: process.env.INSTANTPAY_AUTH_SECRET,
  instantpayEndpointIp: process.env.INSTANTPAY_ENDPOINT_IP || "127.0.0.1",
  instantpayEncryptionKey: process.env.INSTANTPAY_ENCRYPTION_KEY,

  // MSG91 OTP credentials
  msg91AuthKey: process.env.MSG91_AUTH_KEY,
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID,

  // Razorpay Gateway & Route Config
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  // No default: webhooks are rejected until the secret from the Razorpay Dashboard is configured.
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,

  // Shipway Experience API Config
  shipwayUsername: process.env.SHIPWAY_USERNAME,
  shipwayLicenseKey: process.env.SHIPWAY_LICENSE_KEY,

  // Google Cloud Storage
  gcsProjectId: process.env.GCS_PROJECT_ID,
  gcsBucketName: process.env.GCS_BUCKET_NAME || "cikka-uploads-dev",
  gcsKeyFile: process.env.GCS_KEY_FILE,
  gcsSignedUrlExpiry: parseInt(process.env.GCS_SIGNED_URL_EXPIRY || "3600", 10),

  // Resend Email Service Config
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL || "noreply@cikka.club",

  // Public base URL of this API — used to build absolute file URLs (GET /api/files/<key>)
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  ).replace(/\/+$/, ""),

  // File storage provider: "railway" (Railway Bucket, production) or "local" (dev / tests).
  // Defaults to "railway" once bucket credentials are present. "s3" is accepted as an alias.
  storageProvider: (() => {
    const p = (process.env.STORAGE_PROVIDER || (process.env.S3_BUCKET || process.env.BUCKET ? "railway" : "local")).toLowerCase();
    return p === "s3" ? "railway" : p;
  })(),

  // Railway Bucket (S3 API). The unprefixed names are the ones Railway's bucket
  // "Credentials" preset injects (BUCKET, ACCESS_KEY_ID, ...).
  s3Endpoint: process.env.S3_ENDPOINT || process.env.ENDPOINT,
  s3Region: process.env.S3_REGION || process.env.REGION || "auto",
  s3Bucket: process.env.S3_BUCKET || process.env.BUCKET,
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  s3SignedUrlExpiry: parseInt(process.env.S3_SIGNED_URL_EXPIRY || "3600", 10),
};



/**
 * Razorpay stub mode: fake orders/payments so the app can be exercised without keys.
 * Read at call time (tests flip config.isProduction) and never true in production,
 * whatever EXTERNAL_SERVICES_MODE says.
 */
export function isRazorpayStubMode(): boolean {
  return !config.isProduction && config.externalServicesMode !== "real";
}
