import { config } from "../src/config/env";
import { instantpayReal } from "../src/external/instantpay/instantpay.real";

async function runTest() {
  const vpaToTest = process.argv[2] || "ipay.109564@icici";
  const nameToTest = process.argv[3] || "Instantpay India Ltd";

  console.log("==================================================");
  console.log(" 🔍 INSTANTPAY LIVE UPI VPA VERIFICATION TEST");
  console.log("==================================================");
  console.log(` Target VPA     : ${vpaToTest}`);
  console.log(` Target Name    : ${nameToTest}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : ${config.instantpayAuthSecret || "1"}`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  console.log(`⏳ Executing single call via instantpayReal.verifyVpa for: ${vpaToTest} ...`);
  try {
    const result = await instantpayReal.verifyVpa({
      vpa: vpaToTest,
      name: nameToTest,
      externalRef: `ref_${Date.now()}`,
    });

    console.log("\n🎉 INSTANTPAY VPA VERIFICATION RESULT:");
    console.dir(result, { depth: null });
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

runTest();
