import crypto from "crypto";
import { config } from "../src/config/env";
import { instantpayReal, encryptAadhaarAes } from "../src/external/instantpay/instantpay.real";

async function runTest() {
  const aadhaarToTest = process.argv[2] || "439382179844";
  const nameToTest = process.argv[3] || "Vedant Vyas";

  const clientSecret = config.instantpayClientSecret;
  const encryptedBase64 = encryptAadhaarAes(aadhaarToTest, clientSecret);

  console.log("==================================================");
  console.log(" 🔍 INSTANTPAY LIVE AADHAAR DEMOGRAPHIC TEST");
  console.log("==================================================");
  console.log(` Target Aadhaar : ${aadhaarToTest}`);
  console.log(` Encrypted AES  : ${encryptedBase64} (${encryptedBase64.length} chars)`);
  console.log(` Target Name    : ${nameToTest}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : ${config.instantpayAuthSecret || "1"}`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  console.log(`⏳ Executing single call via instantpayReal.verifyAadhaar for: ${aadhaarToTest} ...`);
  try {
    let result = await instantpayReal.verifyAadhaar({
      aadhaarNumber: aadhaarToTest,
      name: nameToTest,
      externalRef: `ref_${Date.now()}`,
    });

    if (result.status && result.status.includes("invalid ip address")) {
      const match = result.status.match(/invalid ip address\s*-\s*([^\s]+)/i);
      if (match && match[1]) {
        const detectedIp = match[1];
        console.log(`\n⚠️ InstantPay detected public IP: ${detectedIp}. Retrying with auto-detected IP...`);
        config.instantpayEndpointIp = detectedIp;
        result = await instantpayReal.verifyAadhaar({
          aadhaarNumber: aadhaarToTest,
          name: nameToTest,
          externalRef: `ref_${Date.now()}`,
        });
      }
    }

    console.log("\n🎉 INSTANTPAY AADHAAR VERIFICATION RESULT:");
    console.dir(result, { depth: null });
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

runTest();
