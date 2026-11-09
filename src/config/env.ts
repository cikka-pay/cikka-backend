import dotenv from "dotenv";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || "development";
const EXTERNAL_SERVICES_MODE = process.env.EXTERNAL_SERVICES_MODE || "stub";

export const config = {
  env: NODE_ENV,
  isProduction: NODE_ENV === "production",
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

  // Setu gateway & BBPS config (toggled via SETU_ENVIRONMENT="uat" | "production")
  setuEnvironment: (() => {
    const env = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase();
    return env === "production" ? "production" : "uat";
  })(),
  setuBaseUrl: (() => {
    const isUat = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase() !== "production";
    if (isUat) {
      return (process.env.SETU_UAT_BASE_URL || "https://uat.setu.co").replace(/\/+$/, "");
    }
    return (process.env.SETU_PROD_BASE_URL || process.env.SETU_BASE_URL || "https://coudc.setu.co").replace(/\/+$/, "");
  })(),
  setuClientId: (() => {
    const isUat = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase() !== "production";
    if (isUat) {
      return process.env.SETU_UAT_CLIENT_ID || "07579493-0c07-496b-b14c-7eef9d65f335";
    }
    return process.env.SETU_PROD_CLIENT_ID || process.env.SETU_CLIENT_ID || "";
  })(),
  setuSecret: (() => {
    const isUat = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase() !== "production";
    if (isUat) {
      return process.env.SETU_UAT_CLIENT_SECRET || "t8C8QxsXYdmMJYmDXwUUUBokKZL2q36t";
    }
    return process.env.SETU_PROD_CLIENT_SECRET || process.env.SETU_CLIENT_SECRET || "";
  })(),
  setuPartnerId: (() => {
    const isUat = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase() !== "production";
    return isUat ? (process.env.SETU_UAT_PARTNER_ID || "") : (process.env.SETU_PARTNER_ID || "");
  })(),
  setuOrgId: (() => {
    const isUat = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase() !== "production";
    return isUat ? (process.env.SETU_UAT_ORG_ID || "") : (process.env.SETU_ORG_ID || "");
  })(),
  setuProductInstanceId: (() => {
    const isUat = (process.env.SETU_ENVIRONMENT || "uat").toLowerCase() !== "production";
    return isUat ? (process.env.SETU_UAT_PRODUCT_INSTANCE_ID || "") : (process.env.SETU_PRODUCT_INSTANCE_ID || "");
  })(),
  setuStandardAccountId: process.env.SETU_STANDARD_ACCOUNT_ID || "",
  setuProductAccountId: process.env.SETU_PRODUCT_ACCOUNT_ID || "",
  setuBasicAuthUser: process.env.SETU_BASIC_AUTH_USER || "setu_user",
  setuBasicAuthPass: process.env.SETU_BASIC_AUTH_PASS || "setu_secret_pass",
  setuBearerToken: process.env.SETU_BEARER_TOKEN,
  setuAllowedIps: process.env.SETU_ALLOWED_IPS ? process.env.SETU_ALLOWED_IPS.split(",").map((ip) => ip.trim()) : [],

  // Setu BBPS Whitelabel & Custom Payment config
  setuBbpsSchemeId: process.env.SETU_BBPS_SCHEME_ID || "setu_bbps_scheme_id",
  setuBbpsSecret: process.env.SETU_BBPS_SECRET || "setu_bbps_secret",
  setuBbpsProductInstanceId: process.env.SETU_BBPS_PRODUCT_INSTANCE_ID || "12c58805-be18-4466-bd36-6b6158cbd151",
  setuBbpsBaseUrl: process.env.SETU_BBPS_BASE_URL || "https://kms.setu.co/api/v2",
  setuCheckStatusUrl: process.env.SETU_CHECK_STATUS_URL || "http://localhost:4000/setu/v1/checkStatus",

  // InstantPay Identity & Verification Config
  instantpayBaseUrl: process.env.INSTANTPAY_BASE_URL || "https://sandbox.instantpay.in/v1",
  instantpayClientId: process.env.INSTANTPAY_CLIENT_ID,
  instantpayClientSecret: process.env.INSTANTPAY_CLIENT_SECRET,
  instantpayAuthSecret: process.env.INSTANTPAY_AUTH_SECRET,
  instantpayEndpointIp: process.env.INSTANTPAY_ENDPOINT_IP || "127.0.0.1",
  instantpayEncryptionKey: process.env.INSTANTPAY_ENCRYPTION_KEY,

  // MSG91 SMS OTP credentials
  msg91AuthKey: process.env.MSG91_AUTH_KEY,
  msg91TemplateId: process.env.MSG91_TEMPLATE_ID,

  // Meta WhatsApp Cloud API (Graph API v21.0)
  metaWhatsappToken: process.env.META_WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN || "",
  metaWhatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  metaWhatsappWabaId: process.env.META_WHATSAPP_WABA_ID || process.env.WHATSAPP_WABA_ID || "",
  metaWhatsappVerifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "",
  metaWhatsappTemplateOrder: process.env.META_WHATSAPP_TEMPLATE_ORDER || "cikka_seller_new_order_alert",

  // Razorpay Gateway & Route Config
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "cikka_route_prod_secret_2026",

  // Shipway Experience API Config
  shipwayUsername: process.env.SHIPWAY_USERNAME,
  shipwayLicenseKey: process.env.SHIPWAY_LICENSE_KEY,
  shipwayMockMode:
    process.env.SHIPWAY_MOCK_MODE === "true" ||
    (process.env.SHIPWAY_MOCK_MODE !== "false" && (process.env.EXTERNAL_SERVICES_MODE === "stub" || process.env.SHIPWAY_MOCK === "true")),

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


