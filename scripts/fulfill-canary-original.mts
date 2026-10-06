import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readFrozenFulfillmentPacket, readFulfillmentAuthorization, completePreparedFulfillment,
  verifyPreparedFulfillment, fulfillmentProviderLedger, retainedFulfillmentDeliveryResolution } from "../lib/business-operator/fulfillment-policy.ts";
import { retainedFailedBusinessCanaryAuthority } from "../lib/business-operator/canary-policy.ts";
import { fulfillCanaryOriginal, preflightOriginalFulfillment } from "../lib/a2a/fulfill-original.ts";
import type { KeryxDB } from "../lib/db/keryx-db.ts";

const usage = `Private one-shot fulfillment of the already-paid failed canary original
  inspect-packet --input <protected-file> --input-sha256 <digest> --manifest <protected-file> --manifest-sha256 <digest>
  preflight --authorization <protected-file> --sha256 <reviewed-digest>
  execute --authorization <protected-file> --sha256 <reviewed-digest>
  verify-prepared
  complete-prepared --prepared-sha256 <exact-reviewed-result-digest>
  status

Provision the fixed owner-only fulfillment registry on the original host/user.
Positively drain all writers; review exact deployed source, native authority, frozen
scope/bodies and official captured tariff before execute. No public activation or schedule.
Execute performs only sufficiency, cited-statement synthesis and separate review,
using three new model reservations. The supplier deadline is fixed; it never renews.
No source/search request, creator payment, new inbound signature or submission exists.
Failure/unknown output retains the unique native claim and every hold. Execute cannot retry.
Inspect the prepared result privately, then complete-prepared uses only idempotent metadata.
Removing selectors alone does not release the unresolved paid-delivery hold.
Preserve the old failed marker and every old/new registry and custody backup.`;
export async function runFulfillCanaryOriginal(argv: string[]) {
  const [command, ...args] = argv;
  if (!command || command === "--help") { console.log(usage); return; }
  if (command === "inspect-packet") {
    const { values } = parseArgs({ args, strict: true, options: { input: { type: "string" }, "input-sha256": { type: "string" },
      manifest: { type: "string" }, "manifest-sha256": { type: "string" } } });
    if (!values.input || !values["input-sha256"] || !values.manifest || !values["manifest-sha256"]) throw new Error("Missing frozen packet binding");
    const packet = readFrozenFulfillmentPacket(values.input, values["input-sha256"], values.manifest, values["manifest-sha256"]);
    console.log(JSON.stringify({ command, readOnly: true, packetSha256: packet.packetSha256,
      inputSemanticSha256: packet.inputSemanticSha256, targets: packet.input.targets.length,
      selectedSources: packet.gathered.length, payments: 0, providerRequests: 0 })); return;
  }
  if (command === "preflight" || command === "execute") {
    const { values } = parseArgs({ args, strict: true, options: { authorization: { type: "string" }, sha256: { type: "string" } } });
    if (!values.authorization || !values.sha256) throw new Error("Missing reviewed authorization binding");
    const binding = readFulfillmentAuthorization(values.authorization, values.sha256, command === "execute");
    if (command === "preflight") {
      console.log(JSON.stringify({ command, readOnly: true, ...await preflightOriginalFulfillment(binding) })); return;
    }
    const credential = process.env.DEEPSEEK_API_KEY;
    if (!credential?.trim()) throw new Error("Explicit supplier credential unavailable");
    const { createApplicationStorage, applicationSqliteIdentity } = await import("../lib/db/application-storage.ts");
    const db = await createApplicationStorage(); if (!db) throw new Error("Enrolled native writer unavailable");
    try {
      applicationSqliteIdentity(db, "write");
      console.log(JSON.stringify({ command, ...await fulfillCanaryOriginal(db, values.authorization, values.sha256, credential) }));
    } finally { (db as KeryxDB & { close?: () => void }).close?.(); }
    return;
  }
  let preparedSha256: string | undefined;
  if (command === "complete-prepared") {
    const { values } = parseArgs({ args, strict: true, options: { "prepared-sha256": { type: "string" } } });
    preparedSha256 = values["prepared-sha256"];
    if (!preparedSha256 || !/^[a-f0-9]{64}$/.test(preparedSha256)) throw new Error("Missing exact reviewed result digest");
  } else if (args.length) throw new Error("Unexpected fulfillment arguments");
  if (command === "status") {
    console.log(JSON.stringify({ command, readOnly: true, providerLedger: fulfillmentProviderLedger(),
      delivery: retainedFulfillmentDeliveryResolution(retainedFailedBusinessCanaryAuthority()), payments: 0, providerRequests: 0 })); return;
  }
  if (command !== "verify-prepared" && command !== "complete-prepared") throw new Error("Unknown fulfillment command");
  const { createApplicationStorage, createReadonlyApplicationStorage, applicationSqliteIdentity } = await import("../lib/db/application-storage.ts");
  const db = command === "verify-prepared" ? await createReadonlyApplicationStorage() : await createApplicationStorage();
  if (!db) throw new Error("Selected enrolled native authority unavailable");
  try {
    applicationSqliteIdentity(db, command === "verify-prepared" ? "read" : "write");
    if (command === "verify-prepared") {
      const proof = await verifyPreparedFulfillment(db);
      console.log(JSON.stringify({ command, readOnly: true, verified: true, runSha256: proof.completion.runSha256,
        preparedResultSha256: proof.preparedResultSha256,
        providerLedgerSha256: proof.completion.providerLedgerSha256, preparedVerified: true, payments: 0, providerRequests: 0 }));
    } else {
      const marker = await completePreparedFulfillment(db, preparedSha256!);
      console.log(JSON.stringify({ command, outcome: marker.outcome, deliveryCompleted: marker.deliveryCompleted,
        paidDeliveryObligation: marker.paidDeliveryObligation, refunded: marker.refunded, noNewInboundPayment: true,
        runSha256: marker.runSha256, payments: 0, providerRequests: 0 }));
    }
  } finally { (db as KeryxDB & { close?: () => void }).close?.(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runFulfillCanaryOriginal(process.argv.slice(2)).catch(() => {
  console.error("Original fulfillment refused or acknowledgement uncertain. Preserve the original, native claim and all provider holds; do not execute again.");
  process.exitCode = 1;
});
