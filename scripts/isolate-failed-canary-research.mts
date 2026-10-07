import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectFailedCanaryResearchIsolation, isolateFailedCanaryResearch } from "../lib/business-operator/canary-research-isolation.ts";
import { fulfillmentExecutorCommit } from "../lib/business-operator/fulfillment-policy.ts";
import type { KeryxDB } from "../lib/db/keryx-db.ts";

export async function runIsolateFailedCanaryResearch(argv: string[]) {
  const [command, ...args] = argv;
  if (!command || command === "--help") {
    console.log("Private metadata-only isolation of an expired, permanently claimed, unprepared failed canary.\ninspect\nisolate --evidence-sha256 <exact inspected digest>\nPreserve every original and hold. Operator remains paused and delivery remains unresolved. No execution retry, new supplier authority, funding, payment, refund or schedule."); return;
  }
  if (command !== "inspect" && command !== "isolate") throw Error("Unknown isolation command");
  const { values } = parseArgs({ args, strict: true, options: { "evidence-sha256": { type: "string" } } });
  if (command === "inspect" && args.length || command === "isolate" && !values["evidence-sha256"]) throw Error("Missing exact isolation evidence");
  fulfillmentExecutorCommit();
  const { createReadonlyApplicationStorage, applicationSqliteIdentity } = await import("../lib/db/application-storage.ts");
  const db = await createReadonlyApplicationStorage(); if (!db) throw Error("Enrolled native observation unavailable");
  try {
    applicationSqliteIdentity(db, "read");
    if (command === "inspect") console.log(JSON.stringify({ command, readOnly: true, ...await inspectFailedCanaryResearchIsolation(db), payments: 0, providerRequests: 0 }));
    else console.log(JSON.stringify({ command, ...await isolateFailedCanaryResearch(db, values["evidence-sha256"]!), payments: 0, providerRequests: 0 }));
  } finally { (db as KeryxDB & { close?: () => void }).close?.(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runIsolateFailedCanaryResearch(process.argv.slice(2)).catch(() => {
  console.error("Failed canary research isolation refused. Preserve the original, native claim and all holds; Operator remains held."); process.exitCode = 1;
});
