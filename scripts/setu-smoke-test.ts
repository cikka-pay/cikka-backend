// Setu BillPay smoke test: config check + token + create link, using the current env.
// Prints a pass/fail summary and never prints secrets (only set/missing).
//
// Usage:
//   npm run setu:smoke
//   SETU_SMOKE_MOBILE=9xxxxxxxxx npm run setu:smoke   # mobile number sent to Setu (default 9876543210)
//   SETU_SMOKE_SKIP_IP=1 npm run setu:smoke           # skip the egress-IP lookup (ipinfo.io)
//
// Setu only accepts Indian IPs, so run it from India or from the Cloud Run service's network.
// Exit code: 0 = pass, 1 = fail.
import { config } from "../src/config/env";
import { createSetuBillpayClient } from "../src/external/setu/billpay.client";
import { SetuBillpayError } from "../src/external/setu/billpay.interface";

type Result = { step: string; ok: boolean; detail: string };
const results: Result[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step.padEnd(8)} ${detail}`);
};

function hint(err: SetuBillpayError): string {
  if (err.code === "CONFIG_MISSING") return "fix the env vars above";
  if (err.code === "NETWORK_ERROR") return "could not reach Setu: check DNS/network";
  if (err.status === 403) return "403 = Setu saw a non-Indian IP; run this from India (production runs in asia-south1)";
  if (err.step === "token" && err.status === 401) {
    return "wrong SETU_BILLPAY_CLIENT_ID/SECRET for this host (prod keys only work on coudc.setu.co, sandbox keys on sandbox-coudc)";
  }
  if (err.step === "link" && err.status >= 400 && err.status < 500) {
    return "token worked, so check SETU_BILLPAY_PARTNER_ID and SETU_BILLPAY_ORG_ID";
  }
  return "see Setu's message above; quote the traceId to Setu support if present";
}

async function egressCountry(): Promise<string> {
  try {
    const res = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as { ip?: string; country?: string; region?: string };
    return `${body.ip ?? "?"} (${body.country ?? "?"}${body.region ? `, ${body.region}` : ""})`;
  } catch {
    return "unknown (lookup failed)";
  }
}

async function main() {
  console.log("Setu BillPay smoke test");
  console.log(`  base URL : ${config.setuBillpayBaseUrl}`);
  console.log(`  mode     : EXTERNAL_SERVICES_MODE=${config.externalServicesMode} (this script always calls Setu)`);
  if (process.env.SETU_SMOKE_SKIP_IP !== "1") {
    console.log(`  egress   : ${await egressCountry()}`);
  }
  console.log("");

  const vars: Record<string, string | undefined> = {
    SETU_BILLPAY_CLIENT_ID: config.setuBillpayClientId,
    SETU_BILLPAY_SECRET: config.setuBillpaySecret,
    SETU_BILLPAY_PARTNER_ID: config.setuBillpayPartnerId,
    SETU_BILLPAY_ORG_ID: config.setuBillpayOrgId,
    SETU_BILLPAY_WEBHOOK_API_KEY: config.setuBillpayWebhookApiKey,
  };
  const status = Object.entries(vars).map(([k, v]) => `${k}=${v ? "set" : "MISSING"}`);
  const requiredMissing = Object.entries(vars).filter(([k, v]) => !v && k !== "SETU_BILLPAY_WEBHOOK_API_KEY");
  record("config", requiredMissing.length === 0, status.join(", "));
  if (!vars.SETU_BILLPAY_WEBHOOK_API_KEY) {
    console.log("      (webhook key missing: link creation works, but Setu webhooks will be rejected)");
  }
  if (requiredMissing.length > 0) return finish();

  const mobileNumber = process.env.SETU_SMOKE_MOBILE || "9876543210";
  const client = createSetuBillpayClient();
  try {
    const link = await client.createLink({ mobileNumber, custID: "setu-smoke-test" });
    record("token", true, "token issued");
    record("link", true, `${link.link} (sessionId ${link.sessionId}${link.traceId ? `, traceId ${link.traceId}` : ""})`);
  } catch (e) {
    if (!(e instanceof SetuBillpayError)) throw e;
    const where = e.step ?? "config";
    if (where === "link") record("token", true, "token issued");
    const trace = e.traceId ? ` traceId=${e.traceId}` : " (no traceId: Setu's app never saw it)";
    record(where, false, `HTTP ${e.status} ${e.code}: ${e.message}${trace}`);
    console.log(`      hint: ${hint(e)}`);
  }
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(failed.length === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed.map((r) => r.step).join(", ")})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
