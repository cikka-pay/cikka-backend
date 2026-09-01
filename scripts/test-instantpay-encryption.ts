import crypto from "crypto";
import { config } from "../src/config/env";

const clientSecret = config.instantpayClientSecret; // bab9d19ff3a8a846432ce9a484ef8c621f9170808ffeefa75bd148b7ea3fa5c6
const clientId = config.instantpayClientId; // YWY3OTAzYzNlM2ExZTJlOVO3HL823O+22baMe7agNVs=
const rawAadhaar = process.argv[2] || "439382179844";

function encAES(text: string, keyBuf: Buffer, ivBuf: Buffer): string {
  try {
    const cipher = crypto.createCipheriv("aes-256-cbc", keyBuf, ivBuf);
    let enc = cipher.update(text, "utf8", "base64");
    enc += cipher.final("base64");
    return enc;
  } catch (e: any) {
    return "";
  }
}

// Config 1: Raw 32 bytes from hex secret + first 16 hex bytes IV
const key1 = Buffer.from(clientSecret, "hex"); // 32 bytes
const iv1 = Buffer.from(clientSecret.substring(0, 32), "hex"); // 16 bytes

// Config 2: Raw 32 bytes from hex secret + 16 zero IV
const key2 = Buffer.from(clientSecret, "hex");
const iv2 = Buffer.alloc(16, 0);

// Config 3: SHA256 of secret (32 bytes) + MD5 of secret (16 bytes)
const key3 = crypto.createHash("sha256").update(clientSecret).digest();
const iv3 = crypto.createHash("md5").update(clientSecret).digest();

// Config 4: SHA256 of secret (32 bytes) + 16 zero IV
const key4 = crypto.createHash("sha256").update(clientSecret).digest();
const iv4 = Buffer.alloc(16, 0);

// Config 5: MD5 of secret doubled (32 bytes) + MD5 of secret (16 bytes)
const md5Sec = crypto.createHash("md5").update(clientSecret).digest("hex");
const key5 = Buffer.from(md5Sec + md5Sec, "utf8").subarray(0, 32);
const iv5 = Buffer.from(md5Sec.substring(0, 16), "utf8");

// Config 6: First 32 UTF8 chars of secret + first 16 UTF8 chars of secret
const key6 = Buffer.from(clientSecret.substring(0, 32), "utf8");
const iv6 = Buffer.from(clientSecret.substring(0, 16), "utf8");

// Config 7: First 32 UTF8 chars of secret + 16 zero IV
const key7 = Buffer.from(clientSecret.substring(0, 32), "utf8");
const iv7 = Buffer.alloc(16, 0);

// Config 8: Key from Client ID (32 bytes) + 16 zero IV
const key8 = crypto.createHash("sha256").update(clientId).digest();
const iv8 = Buffer.alloc(16, 0);

const tests = [
  { name: "Hex Key + Hex IV", aadhaar: encAES(rawAadhaar, key1, iv1) },
  { name: "Hex Key + Zero IV", aadhaar: encAES(rawAadhaar, key2, iv2) },
  { name: "SHA256 Key + MD5 IV", aadhaar: encAES(rawAadhaar, key3, iv3) },
  { name: "SHA256 Key + Zero IV", aadhaar: encAES(rawAadhaar, key4, iv4) },
  { name: "MD5 Key + MD5 IV", aadhaar: encAES(rawAadhaar, key5, iv5) },
  { name: "UTF8 Substring Key + IV", aadhaar: encAES(rawAadhaar, key6, iv6) },
  { name: "UTF8 Substring Key + Zero IV", aadhaar: encAES(rawAadhaar, key7, iv7) },
  { name: "ClientID SHA256 Key + Zero IV", aadhaar: encAES(rawAadhaar, key8, iv8) },
  { name: "Plain Text 12-digit", aadhaar: rawAadhaar },
];

async function run() {
  console.log(`Testing ${tests.length} encryption configurations against InstantPay LIVE...`);
  for (const t of tests) {
    if (!t.aadhaar) continue;
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
          aadhaarNumber: t.aadhaar,
          latitude: "23.0000",
          longitude: "45.0000",
          externalRef: `ref_${Date.now()}`,
          consent: "Y",
        }),
      });
      const data = await res.json();
      console.log(`[${t.name}] => ${data.statuscode} : ${data.status}`);
      if (data.statuscode === "TXN" || data.statuscode === "00") {
        console.log(`\n🎉🎉🎉 FOUND MATCHING ENCRYPTION CONFIG: ${t.name}! 🎉🎉🎉`);
        console.dir(data, { depth: null });
        break;
      }
    } catch (e: any) {
      console.log(`[${t.name}] => Error: ${e.message}`);
    }
  }
}

run();
