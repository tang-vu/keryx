import path from "node:path";
import { z } from "zod";
import { fulfillmentSha256 as hash } from "../a2a/fulfillment-authority";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const labels = ["fresh-parent-native-preflight", "fresh-continuation-native-preflight", "continuation-preflight",
  "continuation-activate-epoch", "continuation-activated-preflight", "continuation-execute-01",
  "continuation-known-failure-native-preflight", "continuation-unresolved-final-native-preflight"] as const;
const lifetimePins = { intentSha256: digest, specSha256: digest, lifetimeReceiptSha256: digest,
  keeperExitSha256: digest, processIntentSha256: digest, processReceiptSha256: digest };
const lifetimePinsSchema = z.object(lifetimePins).strict();
const closureObject = z.object({
  format: z.literal("keryx-original-continuation-quality-failure-closure-v1"), readOnly: z.literal(true), recordedAt: timestamp,
  context: z.string().min(1), executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  parentAuthorizationSha256: digest, nativeClaimSha256: digest, packetSha256: digest, inputSemanticSha256: digest, contextSha256: digest,
  parentProviderLedgerSha256: digest, parentLedgerHeadSha256: digest, parentAnchorFrontierSha256: digest,
  exportSha256: digest, exportReceiptSha256: digest,
  guardian: lifetimePinsSchema,
  inner: z.array(z.object({ label: z.enum(labels), mode: z.enum(["preflight", "activate-epoch", "execute"]),
    authorizationSha256: digest, ...lifetimePins }).strict()).length(8),
}).strict();
export const continuationQualityFailureClosureSchema = z.union([closureObject,
  closureObject.extend({ format: z.literal("keryx-original-continuation-quality-failure-closure-v2") })]);
export type ContinuationQualityFailureClosure = z.infer<typeof continuationQualityFailureClosureSchema>;
export function continuationQualityFailureContext(home: string, failureEpoch: 4 | 5 = 4) {
  if (!path.isAbsolute(home) || path.resolve(home) !== home) throw Error("Quality failure closure home refused");
  if (failureEpoch !== 4 && failureEpoch !== 5) throw Error("Quality failure closure epoch refused");
  return path.join(home, ".local", "share", "keryx-canary-transitions", failureEpoch === 5
    ? "operator-completion-epoch-5-20261008-03" : "operator-completion-epoch-4-20261008-01");
}
export type ContinuationQualityFailureClosureBinding = Pick<ContinuationQualityFailureClosure, "executorCommit" | "parentAuthorizationSha256" |
  "nativeClaimSha256" | "packetSha256" | "inputSemanticSha256" | "contextSha256" | "parentProviderLedgerSha256" |
  "parentLedgerHeadSha256" | "parentAnchorFrontierSha256"> & { parentPreparedAuthorizationSha256: string; approvedAt: string; failureEpoch?: 4 | 5 };
export interface ContinuationQualityFailureClosureIO {
  /** Same protected stable read used for authority/journals; nonempty, <=1MiB. */
  read(file: string, maximumBytes: number): Buffer;
  /** Only the fixed process001 stream paths can be empty. Same protected checks. */
  readStream(file: string, maximumBytes: number): Buffer;
}
const streamSchema = z.object({ ended: z.literal(true), bytes: z.number().int().min(0).max(1_000_000), sha256: digest }).strict();
const processReceiptSchema = z.object({ kind: z.string(), pid: z.number().int().positive(), actualExitCode: z.union([z.literal(0), z.literal(1)]),
  signal: z.null(), errors: z.array(z.never()).length(0), streams: z.object({ stdout: streamSchema, stderr: streamSchema }).strict() }).strict();
const lifetimeReceiptSchema = z.object({ accepted: z.literal(true), admitted: z.literal(true), errors: z.array(z.never()).length(0),
  npmExit: z.object({ actualExitCode: z.union([z.literal(0), z.literal(1)]), signal: z.null() }).strict(),
  bootId: z.string().min(1), rootName: z.string().min(1), operationSucceeded: z.boolean(), allChildrenReaped: z.literal(true), cgroupEmpty: z.literal(true),
  adoptedDescendantExits: z.array(z.object({ pid: z.number().int().positive(), actualExitCode: z.literal(0), signal: z.null() }).strict())
    .max(128).refine(rows => new Set(rows.map(row => row.pid)).size === rows.length),
  admissionCounts: z.object({}).strict(), intentSha256: digest, specSha256: digest }).strict();
function refuse(): never { throw Error("Original continuation quality failure lifetime proof changed; preserve all claims and reservations"); }
const object = (raw: Buffer): Record<string, unknown> => {
  const value: unknown = JSON.parse(raw.toString("utf8"));
  return record(value);
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  return value as Record<string, unknown>;
};

/** A small projection supplements, rather than substitutes for, the independently
 * reviewed full export. Re-read the genuine protected source/receipt bytes for
 * all nine closed lifetimes; a boolean assertion is never a process closure. */
export function validateContinuationQualityFailureClosure(value: unknown, home: string, binding: ContinuationQualityFailureClosureBinding,
  io: ContinuationQualityFailureClosureIO): ContinuationQualityFailureClosure {
  const proof = continuationQualityFailureClosureSchema.parse(value), failureEpoch = binding.failureEpoch ?? 4,
    context = continuationQualityFailureContext(home, failureEpoch);
  if (proof.format !== `keryx-original-continuation-quality-failure-closure-v${failureEpoch === 5 ? 2 : 1}` ||
    proof.context !== context || Date.parse(proof.recordedAt) > Date.parse(binding.approvedAt) || Date.parse(proof.recordedAt) > Date.now()) refuse();
  for (const key of ["executorCommit", "parentAuthorizationSha256", "nativeClaimSha256", "packetSha256", "inputSemanticSha256",
    "contextSha256", "parentProviderLedgerSha256", "parentLedgerHeadSha256", "parentAnchorFrontierSha256"] as const)
    if (proof[key] !== binding[key]) refuse();
  const pinned = (directory: string, name: string, expected: string) => {
    const raw = io.read(path.join(directory, name), 1_000_000);
    if (hash(raw) !== expected) refuse();
    return raw;
  };
  const validateLifetime = (directory: string, pins: z.infer<typeof lifetimePinsSchema>, expectedExit: 0 | 1,
    rootName: string, authorizationSha256?: string, mode?: string) => {
    const intent = object(pinned(directory, "lease-driver-intent.json", pins.intentSha256)),
      spec = object(pinned(directory, "lease-driver-spec.json", pins.specSha256)),
      lifetime = lifetimeReceiptSchema.parse(object(pinned(directory, "lease-driver-receipt.json", pins.lifetimeReceiptSha256))),
      keeper = z.object({ actualExitCode: z.literal(0), signal: z.null(), error: z.null() }).strict()
        .parse(object(pinned(directory, "lease-driver-keeper-exit.json", pins.keeperExitSha256))),
      processIntent = object(pinned(directory, "lease-driver-process-001-intent.json", pins.processIntentSha256)),
      processReceipt = processReceiptSchema.parse(object(pinned(directory, "lease-driver-process-001-receipt.json", pins.processReceiptSha256)));
    const identity = z.object({ pid: z.number().int().positive(), startTicks: z.string().regex(/^\d+$/), state: z.string().min(1) }).strict().parse(processIntent.identity);
    if (!keeper || intent.context !== directory || spec.context !== directory || intent.expectedCommit !== proof.executorCommit ||
      spec.expectedCommit !== proof.executorCommit || spec.intentSha256 !== pins.intentSha256 || lifetime.intentSha256 !== pins.intentSha256 ||
      lifetime.specSha256 !== pins.specSha256 || spec.rootName !== rootName || lifetime.rootName !== rootName ||
      lifetime.npmExit.actualExitCode !== expectedExit || lifetime.operationSucceeded !== (expectedExit === 0) ||
      processReceipt.actualExitCode !== expectedExit || processReceipt.kind !== rootName || processIntent.kind !== rootName || processReceipt.pid !== identity.pid ||
      lifetime.adoptedDescendantExits.some(row => row.pid === identity.pid) ||
      intent.bootId !== lifetime.bootId || spec.bootId !== lifetime.bootId || intent.runId !== spec.runId || intent.cgroup !== spec.cgroup) refuse();
    if (authorizationSha256 && (intent.mode !== mode || record(intent.bindings).authorizationSha256 !== authorizationSha256)) refuse();
    for (const stream of ["stdout", "stderr"] as const) {
      const raw = io.readStream(path.join(directory, `lease-driver-process-001.${stream}`), 1_000_000), capture = processReceipt.streams[stream];
      if (raw.length !== capture.bytes || hash(raw) !== capture.sha256) refuse();
    }
    return intent;
  };
  const guardian = validateLifetime(path.join(context, "g01"), proof.guardian, 1, "same-original-completion-controller");
  if (guardian.kind !== "keryx-native-original-completion-workflow-lifetime-v1" ||
    typeof guardian.controllerProgramSha256 !== "string" || typeof guardian.manifestSha256 !== "string") refuse();
  pinned(context, "program.mjs", guardian.controllerProgramSha256);
  const manifest = object(pinned(context, "guardian-manifest.json", guardian.manifestSha256));
  const operations = record(manifest.operationInputs), grant = record(operations.grant);
  if (manifest.expectedCommit !== proof.executorCommit || operations.nativeClaimSha256 !== proof.nativeClaimSha256 ||
    operations.packetSha256 !== proof.packetSha256 || operations.inputSemanticSha256 !== proof.inputSemanticSha256 ||
    grant.sha256 !== proof.parentAuthorizationSha256) refuse();
  for (let index = 0; index < proof.inner.length; index++) {
    const row = proof.inner[index], mode = index === 3 ? "activate-epoch" : index === 5 ? "execute" : "preflight";
    const authorization = index === 0 ? binding.parentPreparedAuthorizationSha256 : binding.parentAuthorizationSha256;
    if (row.label !== labels[index] || row.mode !== mode || row.authorizationSha256 !== authorization) refuse();
    const intent = validateLifetime(path.join(context, `d${String(index + 1).padStart(2, "0")}`), row, index === 5 ? 1 : 0,
      `original-cli-${mode}`, authorization, mode);
    if (intent.kind !== "keryx-native-original-cli-lifetime-v1") refuse();
  }
  return proof;
}
