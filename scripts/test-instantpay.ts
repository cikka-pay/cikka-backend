import { config } from "../src/config/env";
import { instantpayReal } from "../src/external/instantpay/instantpay.real";

async function runTest() {
  const panToTest = process.argv[2] || "DBKPV9186G";

  console.log("==================================================");
  console.log(" 🔍 INSTANTPAY LIVE PAN VERIFICATION TEST");
  console.log("==================================================");
  console.log(` Target PAN     : ${panToTest}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : ${config.instantpayAuthSecret || "1"}`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  console.log(`⏳ Executing single call via instantpayReal.verifyPan for: ${panToTest} ...`);
  try {
    const result = await instantpayReal.verifyPan({
      pan: panToTest,
      nameOnCard: "Vedant vyas",
      dateOfBirth: "2005-05-27",
    });

    console.log("\n🎉 INSTANTPAY PAN VERIFICATION RESULT:");
    console.dir(result, { depth: null });
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

runTest();
