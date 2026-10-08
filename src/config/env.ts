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

  // Auth secrets
  jwtSecret: process.env.JWT_SECRET || "dev_secret",
  jwtSellerSecret: process.env.JWT_SELLER_SECRET || process.env.JWT_SECRET || "dev_seller_secret",
  jwtUserSecret: process.env.JWT_USER_SECRET || process.env.JWT_CUSTOMER_SECRET || process.env.JWT_SECRET || "dev_user_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  // External service modes
  externalServicesMode: EXTERNAL_SERVICES_MODE,
  isRealExternalServices: EXTERNAL_SERVICES_MODE === "real",

  // Setu gateway config
  setuBaseUrl: process.env.SETU_BASE_URL || "https://uat.setu.co",
  setuClientId: process.env.SETU_CLIENT_ID,
  setuSecret: process.env.SETU_SECRET,
  setuProductInstanceId: process.env.SETU_PRODUCT_INSTANCE_ID,
  setuBasicAuthUser: process.env.SETU_BASIC_AUTH_USER || "setu_user",
  setuBasicAuthPass: process.env.SETU_BASIC_AUTH_PASS || "setu_secret_pass",
  setuBearerToken: process.env.SETU_BEARER_TOKEN,
  setuAllowedIps: process.env.SETU_ALLOWED_IPS ? process.env.SETU_ALLOWED_IPS.split(",").map((ip) => ip.trim()) : [],

  // Setu BBPS Whitelabel & Custom Payment config
  setuBbpsSchemeId: process.env.SETU_BBPS_SCHEME_ID || "setu_bbps_scheme_id",
  setuBbpsSecret: process.env.SETU_BBPS_SECRET || "setu_bbps_secret",
  setuBbpsProductInstanceId: process.env.SETU_BBPS_PRODUCT_INSTANCE_ID || "setu_bbps_instance",
  setuBbpsBaseUrl: process.env.SETU_BBPS_BASE_URL || "https://kms.setu.co/api/v2",
  setuCheckStatusUrl: process.env.SETU_CHECK_STATUS_URL || "http://localhost:4000/setu/v1/checkStatus",

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
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "cikka_route_prod_secret_2026",

  // Shipway Experience API Config
  shipwayUsername: process.env.SHIPWAY_USERNAME,
  shipwayLicenseKey: process.env.SHIPWAY_LICENSE_KEY,

  // Google Cloud Storage
  gcsProjectId: process.env.GCS_PROJECT_ID,
  gcsBucketName: process.env.GCS_BUCKET_NAME || "cikka-uploads-dev",
  gcsKeyFile: process.env.GCS_KEY_FILE,
  gcsSignedUrlExpiry: parseInt(process.env.GCS_SIGNED_URL_EXPIRY || "3600", 10),
};


