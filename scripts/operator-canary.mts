/** Trusted one-host operator commands. No funding, signature, provider request or schedule. */
import { parseArgs } from "node:util";
import {
  activateBusinessCanary, assertPreparedCanarySubmission, businessCanaryHostIdentity,
  assertCanaryOriginalReserved, closeVerifiedBusinessCanary, configuredBusinessCanary, readPreparedBusinessCanaryIntent,
} from "../lib/business-operator/canary-policy.ts";

const usage = `Finite business canary (private operator only)
  npm run operator:canary -- host
  npm run operator:canary -- activate --policy /protected/policy.json --sha256 <exact-sha256>
  npm run operator:canary -- admit --intent /protected/prepared-intent.json
  npm run operator:canary -- status
  npm run operator:canary -- close

Provision the fixed private registry directory as owner-only before activation.
Activation never creates/funds a wallet, signs, pays or adds a schedule.
admit reserves the exact prepared original; use the same trusted POSIX host/user/ledger
from buyer pre-dispatch and the hosted worker. Never copy a consumed policy to a new host.
close requires exact native settled-inbound proof, a matching completed real saved run
and zero creator attempts. Expiry/removing selectors never releases holds.
Keep policy, registry, prepared original and custody backups after closure.
Load the existing reviewed runtime environment explicitly before close.`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") { console.log(usage); return; }
  if (command === "host" && args.length === 0) {
    console.log(JSON.stringify({ executionHostSha256: businessCanaryHostIdentity() })); return;
  }
  if (command === "status" && args.length === 0) {
    const policy = configuredBusinessCanary();
    console.log(JSON.stringify({ configured: !!policy, finiteOriginals: policy?.maximumOriginals ?? null,
      maximumMicroUsd: policy?.maximumMicroUsd ?? null, maximumMicroUsdc: policy?.maximumMicroUsdc ?? null })); return;
  }
  if (command === "activate") {
    const { values } = parseArgs({ args, options: { policy: { type: "string" }, sha256: { type: "string" } }, strict: true });
    if (!values.policy || !values.sha256) throw new Error("Missing policy binding");
    activateBusinessCanary(values.policy, values.sha256);
  } else if (command === "admit") {
    const { values } = parseArgs({ args, options: { intent: { type: "string" } }, strict: true });
    if (!values.intent) throw new Error("Missing prepared original");
    if (!configuredBusinessCanary()) throw new Error("Active canary required for trusted admission");
    assertPreparedCanarySubmission(readPreparedBusinessCanaryIntent(values.intent));
    assertCanaryOriginalReserved();
  } else if (command === "close" && args.length === 0) {
    const { getDb } = await import("../lib/db/index.ts");
    await closeVerifiedBusinessCanary(await getDb());
  } else throw new Error("Unknown canary command");
  console.log(JSON.stringify({ command, completed: true, signatures: 0, payments: 0, providerRequests: 0 }));
}
main().catch(() => {
  console.error("Finite canary command refused. Preserve original journals and holds; review the protected policy and proof.");
  process.exitCode = 1;
});
