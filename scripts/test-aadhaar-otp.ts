import { config } from "../src/config/env";

async function testAadhaarOtp() {
  const aadhaar = process.argv[2] || "439382179844";

  console.log("==================================================");
  console.log(" 🔍 TESTING INSTANTPAY LIVE AADHAAR OTP API");
  console.log("==================================================");
  console.log(` Target Aadhaar : ${aadhaar}`);
  console.log(` Client ID      : ${config.instantpayClientId}`);
  console.log(` Client Secret  : ${config.instantpayClientSecret ? config.instantpayClientSecret.substring(0, 15) + "..." : "MISSING"}`);
  console.log(` Auth Code      : ${config.instantpayAuthSecret || "1"}`);
  console.log(` Endpoint IP    : ${config.instantpayEndpointIp}`);
  console.log("==================================================\n");

  const endpoints = [
    "https://api.instantpay.in/identity/aadhaar/generateOtp",
    "https://api.instantpay.in/identity/aadhaar/otp",
    "https://api.instantpay.in/identity/verifyAadhaar",
  ];

  for (const ep of endpoints) {
    console.log(`⏳ Testing POST ${ep} ...`);
    try {
      const res = await fetch(ep, {
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
          aadhaarNumber: aadhaar,
          latitude: "23.0000",
          longitude: "45.0000",
          externalRef: `ref_${Date.now()}`,
          consent: "Y",
        }),
      });
      const data = await res.json();
      console.log(`Response:`, data.statuscode, "-", data.status);
      console.dir(data, { depth: null });
    } catch (err: any) {
      console.log(`Error: ${err.message}`);
    }
  }
}

testAadhaarOtp();
