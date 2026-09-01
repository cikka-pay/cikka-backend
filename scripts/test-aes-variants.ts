import crypto from "crypto";
import { config } from "../src/config/env";

function encryptVariant1(text: string, secret: string) {
  // Key: First 32 bytes of secret, IV: 16 zero bytes
  const key = Buffer.from(secret.substring(0, 32), "utf8");
  const iv = Buffer.alloc(16, 0);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(text, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

function encryptVariant2(text: string, secret: string) {
  // Key: First 32 bytes of secret, IV: First 16 bytes of secret
  const key = Buffer.from(secret.substring(0, 32), "utf8");
  const iv = Buffer.from(secret.substring(0, 16), "utf8");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(text, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

function encryptVariant3(text: string, secret: string) {
  // Key: SHA256 of secret, IV: 16 zero bytes
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = Buffer.alloc(16, 0);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(text, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

function encryptVariant4(text: string, secret: string) {
  // Key: Hex buffer of secret (32 bytes), IV: Hex buffer of secret (16 bytes)
  const key = Buffer.from(secret, "hex");
  const iv = Buffer.from(secret.substring(0, 32), "hex");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(text, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

async function testAllVariants() {
  const aadhaar = process.argv[2] || "439382179844";
  const secret = config.instantpayClientSecret;

  const v1 = encryptVariant1(aadhaar, secret);
  const v2 = encryptVariant2(aadhaar, secret);
  const v3 = encryptVariant3(aadhaar, secret);
  const v4 = encryptVariant4(aadhaar, secret);

  console.log("Variant 1 (32 char UTF-8 key + 16 zero IV):", v1);
  console.log("Variant 2 (32 char UTF-8 key + 16 char IV)  :", v2);
  console.log("Variant 3 (SHA256 key + 16 zero IV)         :", v3);
  console.log("Variant 4 (Hex key + Hex IV)                :", v4);

  const variants = [
    { name: "Variant 1 (32-char key + 16 zero IV)", payload: v1 },
    { name: "Variant 2 (32-char key + 16-char IV)", payload: v2 },
    { name: "Variant 3 (SHA256 key + 16 zero IV)", payload: v3 },
    { name: "Variant 4 (Hex key + Hex IV)", payload: v4 },
    { name: "Variant 5 (Plain text 12 digits)", payload: aadhaar },
  ];

  for (const v of variants) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Testing ${v.name}: ${v.payload}`);
    try {
      const res = await fetch("https://api.instantpay.in/identity/verifyAadhaar", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-Ipay-Client-Id": config.instantpayClientId,
          "X-Ipay-Client-Secret": config.instantpayClientSecret,
          "X-Ipay-Auth-Code": config.instantpayAuthSecret || "1",
          "X-Ipay-Endpoint-Ip": config.instantpayEndpointIp,
        },
        body: JSON.stringify({
          aadhaarNumber: v.payload,
          latitude: "23.0000",
          longitude: "45.0000",
          externalRef: `ref_${Date.now()}`,
          consent: "Y",
        }),
      });
      const data = await res.json();
      console.log(`Response Status:`, data.statuscode, "-", data.status);
      if (data.statuscode === "TXN" || data.statuscode === "00") {
        console.log(`🎯 SUCCESS FOUND WITH ${v.name}!`);
        console.dir(data, { depth: null });
        break;
      }
    } catch (err: any) {
      console.log(`Error: ${err.message}`);
    }
  }
}

testAllVariants();
