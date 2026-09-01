import { config } from "../src/config/env";
import { instantpayReal } from "../src/external/instantpay/instantpay.real";

async function runTest() {
  const cinToTest = process.argv[2] || "U62099GJ2026PTC174242";

  console.log("==================================================");
  console.log(" 🔍 INSTANTPAY LIVE FETCH PROFILE TEST (company/lookup)");
  console.log("==================================================");
  console.log(` Target CIN     : ${cinToTest}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : ${config.instantpayAuthSecret || "1"}`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  console.log(`⏳ Executing single call via instantpayReal.verifyCin for: ${cinToTest} ...`);
  try {
    const result = await instantpayReal.verifyCin({
      cin: cinToTest,
      externalRef: `ref_${Date.now()}`,
    });

    console.log("\n🎉 INSTANTPAY CIN FETCH PROFILE RESULT:");
    console.dir(result, { depth: null });
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

runTest();
