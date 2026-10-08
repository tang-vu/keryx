/** Synthetic test-only closed lifetimes; these objects certify no real process. */
import path from "node:path";
import { canonicalJson } from "../canonical-json";
import { fulfillmentSha256 as hash } from "../a2a/fulfillment-authority";
import { continuationQualityFailureClosureSchema, continuationQualityFailureContext,
  type ContinuationQualityFailureClosureBinding } from "./continuation-failed-quality-closure";

export function syntheticQualityFailureClosure(home: string, binding: ContinuationQualityFailureClosureBinding) {
  const files = new Map<string, Buffer>(), context = continuationQualityFailureContext(home, binding.failureEpoch),
    retain = (file: string, value: unknown) => {
      const raw = typeof value === "string" ? Buffer.from(value) : Buffer.from(`${canonicalJson(value)}\n`);
      files.set(file, raw); return hash(raw);
    };
  const programSha256 = retain(path.join(context, "program.mjs"), "Synthetic inert controller source"),
    manifestSha256 = retain(path.join(context, "guardian-manifest.json"), { expectedCommit: binding.executorCommit,
      operationInputs: { grant: { sha256: binding.parentAuthorizationSha256 }, nativeClaimSha256: binding.nativeClaimSha256,
        packetSha256: binding.packetSha256, inputSemanticSha256: binding.inputSemanticSha256 } });
  const lifetime = (directory: string, exit: 0 | 1, rootName: string, mode?: string, authorizationSha256?: string) => {
    const intentSha256 = retain(path.join(directory, "lease-driver-intent.json"), { context: directory, expectedCommit: binding.executorCommit,
      kind: mode ? "keryx-native-original-cli-lifetime-v1" : "keryx-native-original-completion-workflow-lifetime-v1",
      runId: path.basename(directory), cgroup: `synthetic-${path.basename(directory)}`, bootId: "synthetic-boot",
      ...(mode ? { mode, bindings: { authorizationSha256 } } : { controllerProgramSha256: programSha256, manifestSha256 }) }),
      specSha256 = retain(path.join(directory, "lease-driver-spec.json"), { context: directory, expectedCommit: binding.executorCommit,
        intentSha256, rootName, runId: path.basename(directory), cgroup: `synthetic-${path.basename(directory)}`, bootId: "synthetic-boot" }),
      lifetimeReceiptSha256 = retain(path.join(directory, "lease-driver-receipt.json"), { accepted: true, admitted: true, errors: [],
        npmExit: { actualExitCode: exit, signal: null }, bootId: "synthetic-boot", rootName, operationSucceeded: exit === 0,
        allChildrenReaped: true, cgroupEmpty: true, adoptedDescendantExits: [], admissionCounts: {}, intentSha256, specSha256 }),
      keeperExitSha256 = retain(path.join(directory, "lease-driver-keeper-exit.json"), { actualExitCode: 0, signal: null, error: null }),
      processIntentSha256 = retain(path.join(directory, "lease-driver-process-001-intent.json"), { kind: rootName,
        identity: { pid: 42, startTicks: "1", state: "R" } });
    const stdout = Buffer.from("Synthetic fully captured stdout"), stderr = Buffer.alloc(0);
    files.set(path.join(directory, "lease-driver-process-001.stdout"), stdout); files.set(path.join(directory, "lease-driver-process-001.stderr"), stderr);
    const processReceiptSha256 = retain(path.join(directory, "lease-driver-process-001-receipt.json"), { kind: rootName, pid: 42,
      actualExitCode: exit, signal: null, errors: [], streams: { stdout: { ended: true, bytes: stdout.length, sha256: hash(stdout) },
        stderr: { ended: true, bytes: stderr.length, sha256: hash(stderr) } } });
    return { intentSha256, specSha256, lifetimeReceiptSha256, keeperExitSha256, processIntentSha256, processReceiptSha256 };
  };
  const labels = ["fresh-parent-native-preflight", "fresh-continuation-native-preflight", "continuation-preflight",
    "continuation-activate-epoch", "continuation-activated-preflight", "continuation-execute-01",
    "continuation-known-failure-native-preflight", "continuation-unresolved-final-native-preflight"];
  const inner = labels.map((label, index) => {
    const mode = index === 3 ? "activate-epoch" : index === 5 ? "execute" : "preflight",
      authorizationSha256 = index === 0 ? binding.parentPreparedAuthorizationSha256 : binding.parentAuthorizationSha256;
    return { label, mode, authorizationSha256, ...lifetime(path.join(context, `d${String(index + 1).padStart(2, "0")}`), index === 5 ? 1 : 0,
      `original-cli-${mode}`, mode, authorizationSha256) };
  });
  const { parentPreparedAuthorizationSha256: _parent3, approvedAt, failureEpoch, ...tuple } = binding;
  const proof = continuationQualityFailureClosureSchema.parse({ format: `keryx-original-continuation-quality-failure-closure-v${failureEpoch === 5 ? 2 : 1}`, readOnly: true,
    recordedAt: approvedAt, context, ...tuple, exportSha256: hash("Synthetic fully reviewed raw export"),
    exportReceiptSha256: hash("Synthetic export capture receipt"),
    guardian: lifetime(path.join(context, "g01"), 1, "same-original-completion-controller"), inner });
  return { proof, files };
}
