/** Trusted one-host operator commands. No funding, signature, provider request or schedule. */
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  activateBusinessCanary, assertPreparedCanarySubmission, businessCanaryHostIdentity,
  assertCanaryOriginalReserved, closeVerifiedBusinessCanary, configuredBusinessCanary, readPreparedBusinessCanaryIntent,
  closeVerifiedFailedBusinessCanary, retainedBusinessCanaryClosure, verifyFailedBusinessCanary,
} from "../lib/business-operator/canary-policy.ts";
import type { KeryxDB } from "../lib/db/keryx-db.ts";

const usage = `Finite business canary (private operator only)
  npm run operator:canary -- host
  npm run operator:canary -- activate --policy /protected/policy.json --sha256 <exact-sha256>
  npm run operator:canary -- admit --intent /protected/prepared-intent.json
  npm run operator:canary -- status
  npm run operator:canary -- close
  npm run operator:canary -- verify-failed
  npm run operator:canary -- close-failed

Provision the fixed private registry directory as owner-only before activation.
Activation never creates/funds a wallet, signs, pays or adds a schedule.
admit reserves the exact prepared original; use the same trusted POSIX host/user/ledger
from buyer pre-dispatch and the hosted worker. Never copy a consumed policy to a new host.
close requires exact native settled-inbound proof, a matching completed real saved run
and zero creator attempts. Expiry/removing selectors never releases holds.
verify-failed uses only the selected enrolled readonly store. close-failed requires
exact settled research_failed proof, no result/payment boundary or creator attempt,
and an intact provider ledger. Positively drain all writers before close-failed.
Failed closure preserves unresolved paid delivery and keeps new admission paused,
including after selector removal. It never completes/refunds/retries the paid job.
Keep policy, registry, prepared original and custody backups after closure.
Load the existing reviewed runtime environment explicitly before close.`;

export async function runOperatorCanary(argv: string[]) {
  const [command, ...args] = argv;
  if (!command || command === "--help") { console.log(usage); return; }
  if (command === "host" && args.length === 0) {
    console.log(JSON.stringify({ executionHostSha256: businessCanaryHostIdentity() })); return;
  }
  if (command === "status" && args.length === 0) {
    const policy = configuredBusinessCanary();
    console.log(JSON.stringify({ configured: !!policy, finiteOriginals: policy?.maximumOriginals ?? null,
      maximumMicroUsd: policy?.maximumMicroUsd ?? null, maximumMicroUsdc: policy?.maximumMicroUsdc ?? null,
      closure: retainedBusinessCanaryClosure() })); return;
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
  } else if ((command === "verify-failed" || command === "close-failed") && args.length === 0) {
    const { createReadonlyApplicationStorage } = await import("../lib/db/application-storage.ts");
    const db = await createReadonlyApplicationStorage();
    if (!db) throw new Error("Selected enrolled readonly proof unavailable");
    try {
      const proof = command === "verify-failed" ? await verifyFailedBusinessCanary(db) : await closeVerifiedFailedBusinessCanary(db);
      console.log(JSON.stringify({ command, readOnly: command === "verify-failed", verified: true,
        closed: command === "close-failed", ...proof, signatures: 0, payments: 0, providerRequests: 0 }));
    } finally { (db as KeryxDB & { close?: () => void }).close?.(); }
    return;
  } else throw new Error("Unknown canary command");
  console.log(JSON.stringify({ command, completed: true, signatures: 0, payments: 0, providerRequests: 0 }));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runOperatorCanary(process.argv.slice(2)).catch(() => {
  console.error("Finite canary command refused. Preserve original journals and holds; review the protected policy and proof.");
  process.exitCode = 1;
});
