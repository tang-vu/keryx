import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readContinuationAuthorization, inspectOriginalContinuation, verifyPreparedContinuation,
  completePreparedContinuation, activateOriginalContinuationEpoch, continuationReadOnlyQualityEvidenceCapability } from "../lib/business-operator/fulfillment-continuation-policy.ts";
import { completeOriginalContinuation, preflightOriginalContinuation } from "../lib/a2a/continue-original.ts";
import { ORIGINAL_FULFILLMENT_LIMITS } from "../lib/a2a/failed-original-fulfillment-protocol.ts";
import type { KeryxDB } from "../lib/db/keryx-db.ts";

const usage = `Private additive continuation of the same already-paid retained original
  preflight --authorization <protected-file> --sha256 <reviewed-digest>
  execute --authorization <protected-file> --sha256 <reviewed-digest>
  activate-epoch --authorization <separate-v2-v3-v4-or-v5-file> --sha256 <reviewed-digest>
  verify-prepared
  complete-prepared --prepared-sha256 <exact-reviewed-result-digest>

Provision an empty root-only first continuation directory and a source-bound owner grant.
An exhausted first episode requires a separately approved V2 grant and activate-epoch;
its irreversible external anchor initializes a fresh additive journal, retaining the old one.
Preserve the expired original authorization, permanent native claim and all old holds.
Execute uses only frozen evidence, checkpointed sufficiency/generation/separate review.
Every new request is durably reserved within one aggregate finite allowance. A known
failed attempt keeps all holds consumed; checkpoint reuse is episode-specific and
quality episodes always use fresh generation and review. Uncertain locks stay held.
Generation uses the existing authorized 8192-token ceiling. No order/payment/search,
creator reward, general admission, scheduler or automatic claim replay is authorized.
Review the prepared answer privately before exact-digest metadata completion.
An independently rejected prepared answer remains immutable. A separately bound V4
quality episode may carry only the same-evidence positive sufficiency and spend its
two remaining calls on fresh generation and review, preserving the original deadline.
A failed V4 pair needs a distinct V5 owner receipt and externally anchored grant,
retaining every old limit, window and outcome. Its agent-chosen six-call allowance
is finite; receipt recording time is not a claimed chat timestamp. Required quote
selection and completeness checks precede any paid direct statement review.`;
export function continuationCliFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const match = /^Original continuation (sufficiency|synthesize|review|assemble) (input-limit|output-validation|transport|incomplete-review|quality|unknown);/.exec(message);
  return { outcome: "refused-or-uncertain", phase: match?.[1] ?? "admission", category: match?.[2] ?? "authority",
    preserveOriginalClaimAndAllReservations: true, deliveryCompleted: false };
}
export async function runContinueCanaryOriginal(argv: string[]) {
  const [command, ...args] = argv;
  if (!command || command === "--help") { console.log(usage); return; }
  let authorizationFile: string | undefined, authorizationSha256: string | undefined, preparedSha256: string | undefined;
  if (command === "preflight" || command === "execute" || command === "activate-epoch") {
    const { values } = parseArgs({ args, strict: true, options: { authorization: { type: "string" }, sha256: { type: "string" } } });
    authorizationFile = values.authorization; authorizationSha256 = values.sha256;
    if (!authorizationFile || !authorizationSha256 || !/^[a-f0-9]{64}$/.test(authorizationSha256)) throw new Error("Missing reviewed continuation binding");
  } else if (command === "complete-prepared") {
    const { values } = parseArgs({ args, strict: true, options: { "prepared-sha256": { type: "string" } } });
    preparedSha256 = values["prepared-sha256"];
    if (!preparedSha256 || !/^[a-f0-9]{64}$/.test(preparedSha256)) throw new Error("Missing exact reviewed result digest");
  } else if (command !== "verify-prepared" || args.length) throw new Error("Unknown continuation command or arguments");
  const binding = authorizationFile && authorizationSha256
    ? readContinuationAuthorization(authorizationFile, authorizationSha256, command === "execute" || command === "activate-epoch") : undefined;
  const credential = command === "execute" ? process.env.DEEPSEEK_API_KEY : undefined;
  if (command === "execute" && !credential?.trim()) throw new Error("Explicit supplier credential unavailable");
  const { createApplicationStorage, createReadonlyApplicationStorage, applicationSqliteIdentity } = await import("../lib/db/application-storage.ts");
  const writing = command === "execute" || command === "complete-prepared";
  const db = await (writing ? createApplicationStorage() : createReadonlyApplicationStorage());
  if (!db) throw new Error("Selected enrolled native authority unavailable");
  try {
    applicationSqliteIdentity(db, writing ? "write" : "read");
    if (command === "preflight") {
      const proof = await inspectOriginalContinuation(db, authorizationFile!, authorizationSha256!);
      const qualityEvidence = binding!.qualityProtocol ? continuationReadOnlyQualityEvidenceCapability(binding!, proof.claim) : undefined;
      const prompt = await preflightOriginalContinuation(binding!.original, binding!.supplement, qualityEvidence);
      console.log(JSON.stringify({ command, readOnly: true, newModelCalls: proof.newModelCalls,
        combinedReservedMicroUsd: proof.combinedReservedMicroUsd, supplierWindowLive: proof.supplierWindowLive,
        executionIntentRetained: proof.executionIntentRetained, prepared: proof.prepared,
        deliveredMarker: proof.deliveredMarker, nativeCompleted: proof.nativeCompleted,
        promptInputBytes: prompt.prompts.map(item => item.promptUtf8Bytes),
        continuationGenerationMaximumOutputTokens: ORIGINAL_FULFILLMENT_LIMITS.maximumOutputTokens,
        payments: 0, searches: 0, providerRequests: 0 }));
    } else if (command === "activate-epoch") {
      console.log(JSON.stringify({ command, ...await activateOriginalContinuationEpoch(db, authorizationFile!, authorizationSha256!) }));
    } else if (command === "execute") {
      console.log(JSON.stringify({ command, ...await completeOriginalContinuation(db, authorizationFile!, authorizationSha256!, credential!) }));
    } else if (command === "verify-prepared") {
      const proof = await verifyPreparedContinuation(db);
      console.log(JSON.stringify({ command, readOnly: true, verified: true, runSha256: proof.completion.runSha256,
        preparedResultSha256: proof.preparedResultSha256, providerLedgerSha256: proof.completion.providerLedgerSha256,
        payments: 0, searches: 0, providerRequests: 0 }));
    } else {
      const marker = await completePreparedContinuation(db, preparedSha256!);
      console.log(JSON.stringify({ command, outcome: marker.outcome, deliveryCompleted: marker.deliveryCompleted,
        paidDeliveryObligation: marker.paidDeliveryObligation, refunded: marker.refunded,
        runSha256: marker.runSha256, noNewInboundPayment: true, payments: 0, searches: 0, providerRequests: 0 }));
    }
  } finally { (db as KeryxDB & { close?: () => void }).close?.(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runContinueCanaryOriginal(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify(continuationCliFailure(error))); process.exitCode = 1;
  });
}
