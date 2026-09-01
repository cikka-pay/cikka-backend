import { config } from "../src/config/env";
import { instantpayReal } from "../src/external/instantpay/instantpay.real";

async function runTest() {
  const gstinToTest = process.argv[2] || "24ABSCS9486L1Z7";

  console.log("==================================================");
  console.log(" 🔍 INSTANTPAY LIVE GSTIN VERIFICATION TEST");
  console.log("==================================================");
  console.log(` Target GSTIN   : ${gstinToTest}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : 1`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  console.log(`⏳ Executing single call via instantpayReal.verifyGstin for: ${gstinToTest} ...`);
  try {
    const result = await instantpayReal.verifyGstin({
      gstNumber: gstinToTest,
      externalRef: `ref_${Date.now()}`,
    });
    console.log("\n🎉 INSTANTPAY GSTIN VERIFICATION RESULT:");
    console.dir(result, { depth: null });
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

runTest();
