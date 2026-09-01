import { config } from "../src/config/env";
import { instantpayReal } from "../src/external/instantpay/instantpay.real";

async function runTest() {
  const accountToTest = process.argv[2] || "91234567890";
  const ifscToTest = process.argv[3] || "HDFC0001234";
  const nameToTest = process.argv[4] || "SHAHBAZ STORE";

  console.log("==================================================");
  console.log(" 🔍 INSTANTPAY LIVE PENNY DROP BANK VERIFICATION TEST");
  console.log("==================================================");
  console.log(` Target Account : ${accountToTest}`);
  console.log(` Target IFSC    : ${ifscToTest}`);
  console.log(` Target Name    : ${nameToTest}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : ${config.instantpayAuthSecret || "1"}`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  console.log(`⏳ Executing single call via instantpayReal.verifyBankAccount for: ${accountToTest} (${ifscToTest}) ...`);
  try {
    const result = await instantpayReal.verifyBankAccount({
      accountNumber: accountToTest,
      bankIfsc: ifscToTest,
      name: nameToTest,
      externalRef: `ref_${Date.now()}`,
    });

    console.log("\n🎉 INSTANTPAY BANK PENNY DROP VERIFICATION RESULT:");
    console.dir(result, { depth: null });
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

runTest();
