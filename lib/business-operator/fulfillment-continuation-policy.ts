import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { continuationEpochAuthorizationFields, fixedPaths, readActiveEpochAnchor, readLatestEpochAnchor, activateEpochAnchor,
  beginEpochLedgerUpdate, completeEpochLedgerUpdate,
  type ContinuationEpochIO, type ContinuationEpochBinding } from "./continuation-epoch";
import { continuationSupplementEpochAuthorizationFields } from "./continuation-supplement-epoch";
import { continuationPreparedEpochAuthorizationFields, continuationPreparedRejectionSchema } from "./continuation-prepared-epoch";
import { continuationFailedQualityEpochAuthorizationFields, continuationOwnerRepairReceiptSchema } from "./continuation-failed-quality-epoch";
import { continuationQualityFailureContext, validateContinuationQualityFailureClosure } from "./continuation-failed-quality-closure";
import { readBoundSupplementaryContext, assertSupplementaryRunBinding, fulfillmentEvidenceCapability,
  type FulfillmentSupplementContext } from "../a2a/fulfillment-supplement-evidence";
import { businessCanaryHostIdentity, verifyFailedBusinessCanary,
  type FailedBusinessCanaryProofDb, type RetainedFailedCanaryAuthority } from "./canary-policy";
import { fulfillmentDirectory, fulfillmentExecutorCommit, fulfillmentProviderLedger,
  readRetainedFulfillmentBinding, readRetainedFulfillmentClaim } from "./fulfillment-policy";
import { ORIGINAL_FULFILLMENT_LIMITS as LIMITS } from "../a2a/fulfillment-limits";
import { fulfillmentSha256 as hash,
  fulfillmentObjectSha256 as hashObject, validateFulfilledQueryRun,
  type A2aFulfillmentClaim, type A2aFulfillmentCompletion } from "../a2a/failed-original-fulfillment-protocol";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const stageSchema = z.enum(["sufficiency", "synthesize", "review"]);
export type ContinuationStage = z.infer<typeof stageSchema>;
const stages: ContinuationStage[] = ["sufficiency", "synthesize", "review"];
const diagnosticSchema = z.object({ phase: z.enum(["sufficiency", "synthesize", "review", "assemble"]),
  category: z.enum(["input-limit", "output-validation", "transport", "incomplete-review", "quality", "unknown"]) }).strict();
function refuse(reason: string): never { throw new Error(`Original continuation ${reason}; preserve all claims and reservations`); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const now = () => new Date().toISOString();

/** New supplier permission is additive. Neither the old claim nor its expired window changes. */
const continuationAuthorizationObject = z.object({
  format: z.literal("keryx-original-continuation-authorization-v1"),
  approvalId: z.literal("operator-business-20261006"), approvedAt: timestamp,
  ownerAuthorizationSha256: digest, ownerAuthorizationReceivedAt: timestamp,
  expiresAt: timestamp, maximumDurationMs: z.literal(86_400_000),
  executionHostSha256: digest, executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  originalAuthorizationSha256: digest, originalClaimSha256: digest, nativeClaimSha256: digest,
  originalFulfillmentProviderLedgerSha256: digest,
  policySha256: digest, failedClosureSha256: digest, originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  inputSemanticSha256: digest, packetSha256: digest,
  tariffFile: z.string().min(1), tariffBodySha256: digest, tariffRetrievedAt: timestamp,
  tariffUrl: z.literal("https://api-docs.deepseek.com/quick_start/pricing/"),
  tariffInputUsdPerMillion: z.literal(0.30), tariffOutputUsdPerMillion: z.literal(1.20),
  provider: z.literal("deepseek"), endpoint: z.literal("https://api.deepseek.com/chat/completions"),
  model: z.literal("deepseek-v4-flash"), reserveMicroUsd: z.literal(LIMITS.modelReserveMicroUsd),
  maximumNewModelCalls: z.number().int().min(3).max(8),
  historicalReservedMicroUsd: z.literal(77_980), maximumCombinedMicroUsd: z.literal(LIMITS.maximumCombinedMicroUsd),
  searches: z.literal("forbidden"), creatorPayments: z.literal("forbidden"), newInboundPayment: z.literal("forbidden"),
}).strict();
export const continuationAuthorizationSchema = z.union([continuationAuthorizationObject,
  continuationAuthorizationObject.extend(continuationEpochAuthorizationFields),
  continuationAuthorizationObject.extend(continuationSupplementEpochAuthorizationFields),
  continuationAuthorizationObject.extend(continuationPreparedEpochAuthorizationFields),
  continuationAuthorizationObject.extend(continuationFailedQualityEpochAuthorizationFields)]).refine(value =>
  Date.parse(value.ownerAuthorizationReceivedAt) <= Date.parse(value.approvedAt) &&
  Date.parse(value.approvedAt) < Date.parse(value.expiresAt) &&
  Date.parse(value.expiresAt) - Date.parse(value.ownerAuthorizationReceivedAt) <= value.maximumDurationMs,
"Continuation outside explicit owner window");
export type ContinuationAuthorization = z.infer<typeof continuationAuthorizationSchema>;
function isCarriedQualityAuthorization(authorization: ContinuationAuthorization): authorization is Extract<ContinuationAuthorization,
  { format: "keryx-original-continuation-authorization-v4" | "keryx-original-continuation-authorization-v5" }> {
  return authorization.format === "keryx-original-continuation-authorization-v4" || authorization.format === "keryx-original-continuation-authorization-v5";
}
export function continuationDirectory() {
  return readLatestEpochAnchor(os.homedir(), epochIo())?.paths.epochDirectory ?? fixedPaths(os.homedir()).parentDirectory;
}
function exists(file: string) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
function protectedPath(file: string, directory: boolean) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) refuse("protected path refused");
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) refuse("protected type refused");
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) refuse("permissions refused");
    for (let parent = path.dirname(file);; parent = path.dirname(parent)) {
      const value = fs.lstatSync(parent);
      if (value.isSymbolicLink() || !value.isDirectory() || (value.mode & 0o022) !== 0 ||
        value.uid !== 0 && value.uid !== process.getuid!()) refuse("writable or foreign ancestor refused");
      if (parent === path.dirname(parent)) break;
    }
  }
  return stat;
}
function read(file: string, maximumBytes = 1_000_000, minimumBytes: 0 | 1 = 1) {
  protectedPath(file, false); const before = fs.lstatSync(file, { bigint: true });
  const signature = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs,
    stat.ctimeNs, stat.uid, stat.gid, stat.mode, stat.nlink].join(":");
  if (minimumBytes === 0 && (path.basename(file) !== "lease-driver-process-001.stdout" && path.basename(file) !== "lease-driver-process-001.stderr" ||
    !/^(?:g01|d0[1-8])$/.test(path.basename(path.dirname(file))) ||
    path.dirname(path.dirname(file)) !== continuationQualityFailureContext(os.homedir()))) refuse("empty stream path refused");
  if (before.size < BigInt(minimumBytes) || before.size > BigInt(maximumBytes)) refuse("protected file byte limit refused");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (signature(fs.fstatSync(fd, { bigint: true })) !== signature(before)) refuse("file changed during read");
    const bytes = fs.readFileSync(fd);
    protectedPath(file, false);
    if (BigInt(bytes.length) !== before.size || signature(fs.fstatSync(fd, { bigint: true })) !== signature(before) ||
      signature(fs.lstatSync(file, { bigint: true })) !== signature(before)) refuse("file changed during read");
    return bytes;
  } finally { fs.closeSync(fd); }
}
const json = (file: string) => JSON.parse(read(file).toString("utf8")) as unknown;
function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function epochIo(flush = syncDirectory): ContinuationEpochIO {
  return { exists, read, assertProtectedPath: protectedPath, list: directory => fs.readdirSync(directory),
    ensureDirectory(directory) {
      if (!exists(directory)) { fs.mkdirSync(directory, { mode: 0o700 }); flush(path.dirname(directory)); }
      protectedPath(directory, true);
    },
    retainRecord(file, value) {
      protectedPath(path.dirname(file), true);
      const bytes = Buffer.from(`${canonicalJson(value)}\n`), fd = fs.openSync(file, "wx", 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      flush(path.dirname(file));
      if (!read(file).equals(bytes)) refuse("epoch publication acknowledgement uncertain");
    },
    releaseRecordExact(file, sha256) {
      if (hash(read(file)) !== sha256) refuse("epoch activation lock changed");
      fs.unlinkSync(file); flush(path.dirname(file));
    },
    replaceRecordExact(file, previousSha256, value) {
      if (hash(read(file)) !== previousSha256) refuse("epoch frontier publication raced");
      const bytes = Buffer.from(`${canonicalJson(value)}\n`), directory = path.dirname(file);
      const temporary = path.join(directory, `frontier-next-${randomBytes(16).toString("hex")}.json`);
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (hash(read(file)) !== previousSha256 || !read(temporary).equals(bytes)) refuse("epoch frontier publication raced");
      fs.renameSync(temporary, file); flush(directory);
      if (!read(file).equals(bytes)) refuse("epoch frontier acknowledgement uncertain");
    } };
}
const nonLedgerNames = new Set(["execution-lock.json", "ledger-head.json", "prepared-result.json", "delivered.json"]);
function rawEntries(directory = continuationDirectory()) {
  return fs.readdirSync(directory).sort().filter(name => !nonLedgerNames.has(name))
    .map(name => ({ name, sha256: hash(read(path.join(directory, name))) }));
}
function assertLedgerHead(directory = continuationDirectory()) {
  const file = path.join(directory, "ledger-head.json"), entries = rawEntries(directory);
  if (!exists(file)) {
    if (entries.length) refuse("durable ledger head missing");
    return null;
  }
  const head = z.object({ format: z.literal("keryx-original-continuation-ledger-head-v1"),
    entries: z.array(z.object({ name: z.string(), sha256: digest }).strict()), entriesSha256: digest }).strict().parse(json(file));
  if (!same(head.entries, entries) || head.entriesSha256 !== hashObject(entries)) refuse("durable ledger head changed");
  return hash(read(file));
}
function publishLedgerHead(previous: string | null, flush: (directory: string) => void, directory = continuationDirectory()) {
  const file = path.join(directory, "ledger-head.json");
  if (previous === null ? exists(file) : !exists(file) || hash(read(file)) !== previous) refuse("ledger head publication raced");
  const entries = rawEntries(directory), value = { format: "keryx-original-continuation-ledger-head-v1", entries, entriesSha256: hashObject(entries) };
  const bytes = Buffer.from(`${canonicalJson(value)}\n`), temporary = path.join(directory, "ledger-head-next.json");
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (previous === null ? exists(file) : hash(read(file)) !== previous) refuse("ledger head publication raced");
  fs.renameSync(temporary, file); flush(directory);
  if (!read(file).equals(bytes)) refuse("ledger head acknowledgement uncertain");
}
function retain(name: string, value: unknown, flush = syncDirectory, directory = continuationDirectory()) {
  protectedPath(directory, true);
  const previousHead = assertLedgerHead(directory);
  const epochPaths = fixedPaths(os.homedir(), directory === fixedPaths(os.homedir(), 5).epochDirectory ? 5 :
    directory === fixedPaths(os.homedir(), 4).epochDirectory ? 4 :
    directory === fixedPaths(os.homedir(), 3).epochDirectory ? 3 : 2), io = epochIo(flush);
  const epochUpdate = !nonLedgerNames.has(name) && directory === epochPaths.epochDirectory && exists(epochPaths.frontierFile)
    ? beginEpochLedgerUpdate(os.homedir(), io) : null;
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  const file = path.join(directory, name), fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  flush(directory);
  if (!read(file).equals(bytes)) refuse("durable publication acknowledgement uncertain");
  if (!nonLedgerNames.has(name)) {
    publishLedgerHead(previousHead, flush, directory);
    if (epochUpdate) completeEpochLedgerUpdate(epochUpdate, hash(read(path.join(directory, "ledger-head.json"))), io);
  }
}
const retainedSchema = z.object({ format: z.literal("keryx-original-continuation-retained-authorization-v1"),
  authorizationFile: z.string().min(1), authorizationSha256: digest }).strict();
const attemptSchema = z.object({ format: z.literal("keryx-original-continuation-attempt-v1"),
  authorizationSha256: digest, claimId: digest, attempt: z.number().int().min(1).max(8),
  attemptId: digest, startedAt: timestamp }).strict();
const attemptOutcomeSchema = z.object({ format: z.literal("keryx-original-continuation-attempt-outcome-v1"),
  attemptId: digest, endedAt: timestamp, outcome: z.enum(["review-completed", "failed", "revoked"]) }).strict();
const diagnosticRecordSchema = z.object({ format: z.literal("keryx-original-continuation-diagnostic-v1"), attemptId: digest,
  recordedAt: timestamp, diagnostic: diagnosticSchema }).strict();
const holdSchema = z.object({ format: z.literal("keryx-original-continuation-model-hold-v1"),
  authorizationSha256: digest, claimId: digest, attemptId: digest,
  slot: z.number().int().min(1).max(8), stage: stageSchema, promptSha256: digest,
  packetSha256: digest, inputSemanticSha256: digest, executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  reservedAt: timestamp, reserveMicroUsd: z.literal(LIMITS.modelReserveMicroUsd),
  inputBytes: z.number().int().min(1).max(LIMITS.maximumInputBytes),
  maximumOutputTokens: z.number().int().min(1).max(LIMITS.maximumOutputTokens),
  outcome: z.literal("held-regardless-of-provider-outcome") }).strict();
const contextualHoldSchema = holdSchema.extend({ contextSha256: digest });
const checkpointSchema = z.object({ format: z.literal("keryx-original-continuation-checkpoint-v1"),
  holdSha256: digest, resultSha256: digest, completedAt: timestamp, result: z.record(z.string(), z.unknown()) }).strict();
const callOutcomeSchema = z.object({ format: z.literal("keryx-original-continuation-model-outcome-v1"),
  holdSha256: digest, checkpointSha256: digest.nullable(), completedAt: timestamp,
  outcome: z.enum(["normalized-json-checkpoint", "failed-no-reusable-output"]) }).strict();
const carriedSufficiencySchema = z.object({ format: z.literal("keryx-original-continuation-carried-sufficiency-v1"),
  parentAuthorizationSha256: digest, parentHoldSha256: digest, parentCheckpointSha256: digest,
  parentResultSha256: digest, promptSha256: digest, contextSha256: digest,
  inputBytes: z.number().int().min(1).max(LIMITS.maximumInputBytes),
  maximumOutputTokens: z.number().int().min(1).max(LIMITS.maximumOutputTokens),
  result: z.record(z.string(), z.unknown()) }).strict();
const preparedSchema = z.object({ format: z.literal("keryx-original-continuation-prepared-result-v1"),
  authorizationSha256: digest, nativeClaimSha256: digest, claimId: digest, originalId: z.string(),
  runSha256: digest, providerLedgerSha256: digest, completedAt: timestamp, run: z.unknown(), contextSha256: digest.optional() }).strict();
const deliverySchema = z.object({ format: z.literal("keryx-original-continuation-delivered-v1"),
  authorizationSha256: digest, originalAuthorizationSha256: digest, nativeClaimSha256: digest,
  policySha256: digest, failedClosureSha256: digest, originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  originalFulfillmentProviderLedgerSha256: digest, claimId: digest, runSha256: digest, providerLedgerSha256: digest,
  preparedResultSha256: digest, completedAt: timestamp, outcome: z.literal("verified-fulfilled-original"),
  admissionPaused: z.literal(false), paidDeliveryObligation: z.literal("resolved"), deliveryCompleted: z.literal(true),
  refunded: z.literal(false), noNewInboundPayment: z.literal(true) }).strict();
export interface ContinuationBinding {
  authorization: ContinuationAuthorization; authorizationFile: string; authorizationSha256: string; directory: string;
  original: ReturnType<typeof readRetainedFulfillmentBinding>; local: ReturnType<typeof readRetainedFulfillmentClaim>;
  supplement?: FulfillmentSupplementContext;
  carriedSufficiency?: z.infer<typeof carriedSufficiencySchema>;
  qualityProtocol?: "same-evidence-prepared-quality-v1";
}
export function readContinuationAuthorization(file: string, expectedSha256: string, supplier = false): ContinuationBinding {
  digest.parse(expectedSha256); const bytes = read(file, 65_536);
  if (hash(bytes) !== expectedSha256) refuse("authorization changed");
  const authorization = continuationAuthorizationSchema.parse(JSON.parse(bytes.toString("utf8")));
  const original = readRetainedFulfillmentBinding(), local = readRetainedFulfillmentClaim(original);
  const oldLedger = fulfillmentProviderLedger(original);
  if (authorization.originalAuthorizationSha256 !== original.authorizationSha256 ||
    authorization.originalClaimSha256 !== hash(read(path.join(fulfillmentDirectory(), "claim.json"))) ||
    authorization.originalFulfillmentProviderLedgerSha256 !== oldLedger.sha256 || oldLedger.newModelCalls !== 2 ||
    oldLedger.combinedReservedMicroUsd !== 77_980 ||
    authorization.policySha256 !== original.authority.policySha256 || authorization.failedClosureSha256 !== original.authority.failedClosureSha256 ||
    authorization.originalEvidenceSha256 !== original.authority.originalEvidenceSha256 ||
    authorization.originalProviderLedgerSha256 !== original.authority.originalProviderLedgerSha256 ||
    authorization.packetSha256 !== original.packet.packetSha256 || authorization.inputSemanticSha256 !== original.packet.inputSemanticSha256 ||
    Date.now() < Date.parse(original.authorization.expiresAt) ||
    exists(path.join(fulfillmentDirectory(), "prepared-result.json")) || exists(path.join(fulfillmentDirectory(), "delivered.json")))
    refuse("retained original authority changed or not eligible");
  if (authorization.executionHostSha256 !== businessCanaryHostIdentity() || Date.parse(authorization.approvedAt) > Date.now() ||
    Date.parse(authorization.tariffRetrievedAt) > Date.parse(authorization.approvedAt) ||
    authorization.tariffRetrievedAt.slice(0, 10) !== authorization.approvedAt.slice(0, 10) ||
    hash(read(authorization.tariffFile, 200_000)) !== authorization.tariffBodySha256)
    refuse("host, approval or current tariff refused");
  const paths = fixedPaths(os.homedir());
  if (authorization.format === "keryx-original-continuation-authorization-v2") {
    const parent = readContinuationAuthorization(authorization.parentAuthorizationFile, authorization.parentAuthorizationSha256);
    if (parent.authorization.format !== "keryx-original-continuation-authorization-v1" ||
      parent.directory !== paths.parentDirectory || authorization.executorCommit === parent.authorization.executorCommit ||
      authorization.ownerAuthorizationSha256 !== parent.authorization.ownerAuthorizationSha256 ||
      authorization.ownerAuthorizationReceivedAt !== parent.authorization.ownerAuthorizationReceivedAt ||
      Date.parse(authorization.expiresAt) > Date.parse(parent.authorization.expiresAt)) refuse("additive epoch authority changed");
    const parentLedger = continuationProviderLedger(parent);
    if (parentLedger.newModelCalls !== 8 || parentLedger.combinedReservedMicroUsd !== authorization.historicalReservedMicroUsd ||
      parentLedger.sha256 !== authorization.parentProviderLedgerSha256 ||
      assertLedgerHead(parent.directory) !== authorization.parentLedgerHeadSha256 ||
      parentLedger.attempts.some(attempt => !exists(path.join(parent.directory, `attempt-${numberName(attempt.attempt)}-outcome.json`))) ||
      parentLedger.holds.some(item => !exists(path.join(parent.directory, `call-${numberName(item.hold.slot)}-outcome.json`))) ||
      ["execution-lock.json", "prepared-result.json", "delivered.json"].some(name => exists(path.join(parent.directory, name))))
      refuse("parent epoch is changed, uncertain or incomplete");
  }
  let supplement: FulfillmentSupplementContext | undefined;
  let carriedSufficiency: z.infer<typeof carriedSufficiencySchema> | undefined;
  if (authorization.format === "keryx-original-continuation-authorization-v3") {
    const parent = readContinuationAuthorization(authorization.parentAuthorizationFile, authorization.parentAuthorizationSha256);
    if (parent.authorization.format !== "keryx-original-continuation-authorization-v2" || parent.directory !== paths.epochDirectory ||
      authorization.ownerAuthorizationSha256 !== parent.authorization.ownerAuthorizationSha256 ||
      authorization.ownerAuthorizationReceivedAt !== parent.authorization.ownerAuthorizationReceivedAt ||
      authorization.expiresAt !== parent.authorization.expiresAt ||
      !same(original, parent.original) || !same(local, parent.local)) refuse("supplementary remainder authority changed");
    const anchor = readActiveEpochAnchor(os.homedir(), epochIo(), 2), parentLedger = continuationProviderLedger(parent);
    if (!anchor || anchor.binding.authorizationFile !== parent.authorizationFile ||
      anchor.binding.authorizationSha256 !== parent.authorizationSha256 || anchor.intentSha256 !== authorization.parentAnchorIntentSha256 ||
      anchor.activeSha256 !== authorization.parentAnchorActiveSha256 || anchor.frontierSha256 !== authorization.parentAnchorFrontierSha256 ||
      anchor.ledgerHeadSha256 !== authorization.parentLedgerHeadSha256 ||
      parentLedger.newModelCalls !== 1 || parentLedger.combinedReservedMicroUsd !== authorization.historicalReservedMicroUsd ||
      parentLedger.sha256 !== authorization.parentProviderLedgerSha256 || parentLedger.attempts.length !== 1 ||
      ["execution-lock.json", "prepared-result.json", "delivered.json"].some(name => exists(path.join(parent.directory, name))))
      refuse("supplementary predecessor is changed or uncertain");
    const held = parentLedger.holds[0], attempt = parentLedger.attempts[0];
    const rawHash = (name: string) => hash(read(path.join(parent.directory, name)));
    const diagnostic = parentLedger.diagnostics;
    if (held.hold.stage !== "sufficiency" || !held.checkpoint || held.hold.attemptId !== attempt.attemptId ||
      held.sha256 !== authorization.parentSufficiencyHoldSha256 ||
      rawHash("call-01-checkpoint.json") !== authorization.parentSufficiencyCheckpointSha256 ||
      held.checkpoint.resultSha256 !== authorization.parentSufficiencyResultSha256 ||
      rawHash("attempt-01-outcome.json") !== authorization.parentAttemptOutcomeSha256 ||
      !exists(path.join(parent.directory, "call-01-outcome.json")) || diagnostic.length !== 1 ||
      diagnostic[0].attemptId !== attempt.attemptId || diagnostic[0].diagnostic.phase !== "sufficiency" ||
      diagnostic[0].diagnostic.category !== "quality" || rawHash("diagnostic-01.json") !== authorization.parentSufficiencyDiagnosticSha256)
      refuse("acknowledged predecessor evidence gap changed");
    const rows = held.checkpoint.result.perClaim;
    if (original.packet.input.targets.length !== 5 || !same(original.authorization.requiredSupportedTargetIndexes, [0, 1, 2, 3, 4]) ||
      !Array.isArray(rows) || rows.length !== 5 || rows.some((row, index) => !row || typeof row !== "object" ||
        (row as Record<string, unknown>).claim !== original.packet.input.targets[index] ||
        typeof (row as Record<string, unknown>).coverage !== "number" || !Number.isFinite((row as Record<string, unknown>).coverage) ||
        Number((row as Record<string, unknown>).coverage) < 0 || Number((row as Record<string, unknown>).coverage) > 1 ||
        typeof (row as Record<string, unknown>).supportedAnswer !== "string" ||
        !Array.isArray((row as Record<string, unknown>).coveredBy) ||
        ((row as Record<string, unknown>).coveredBy as unknown[]).some(marker =>
          typeof marker !== "string" || !original.packet.gathered.some(source => source.marker === marker)) ||
        !Array.isArray((row as Record<string, unknown>).missingRequestedParts) ||
        ((row as Record<string, unknown>).missingRequestedParts as unknown[]).some(part => typeof part !== "string" || !part.trim())) ||
      !original.authorization.requiredSupportedTargetIndexes.some(index => Number((rows[index] as Record<string, unknown>).coverage) < 0.4 &&
        ((rows[index] as Record<string, unknown>).missingRequestedParts as unknown[]).length > 0))
      refuse("predecessor checkpoint does not establish the original mandatory gap");
    supplement = readBoundSupplementaryContext(authorization.supplementaryInputFile, authorization.supplementaryInputSha256,
      original, { nativeClaimSha256: authorization.nativeClaimSha256, ownerAuthorizationSha256: authorization.ownerAuthorizationSha256,
        executorCommit: authorization.executorCommit });
    if (supplement.contextSha256 !== authorization.contextSha256) refuse("supplementary context changed");
  }
  if (authorization.format === "keryx-original-continuation-authorization-v4") {
    const parent = readContinuationAuthorization(authorization.parentAuthorizationFile, authorization.parentAuthorizationSha256);
    if (parent.authorization.format !== "keryx-original-continuation-authorization-v3" || !parent.supplement ||
      parent.directory !== fixedPaths(os.homedir(), 3).epochDirectory || !same(parent.original, original) || !same(parent.local, local) ||
      authorization.ownerAuthorizationSha256 !== parent.authorization.ownerAuthorizationSha256 ||
      authorization.ownerAuthorizationReceivedAt !== parent.authorization.ownerAuthorizationReceivedAt || authorization.expiresAt !== parent.authorization.expiresAt ||
      authorization.supplementaryInputFile !== parent.authorization.supplementaryInputFile ||
      authorization.supplementaryInputSha256 !== parent.authorization.supplementaryInputSha256 || authorization.contextSha256 !== parent.authorization.contextSha256)
      refuse("prepared quality recovery authority changed");
    const anchor = readActiveEpochAnchor(os.homedir(), epochIo(), 3), parentLedger = continuationProviderLedger(parent);
    if (!anchor || anchor.binding.authorizationFile !== parent.authorizationFile || anchor.binding.authorizationSha256 !== parent.authorizationSha256 ||
      anchor.intentSha256 !== authorization.parentAnchorIntentSha256 || anchor.activeSha256 !== authorization.parentAnchorActiveSha256 ||
      anchor.frontierSha256 !== authorization.parentAnchorFrontierSha256 || anchor.ledgerHeadSha256 !== authorization.parentLedgerHeadSha256 ||
      parentLedger.sha256 !== authorization.parentProviderLedgerSha256 || parentLedger.newModelCalls !== 3 || parentLedger.combinedReservedMicroUsd !== 325_900 ||
      parentLedger.attempts.length !== 1 || parentLedger.diagnostics.length !== 0 ||
      ["execution-lock.json", "delivered.json"].some(name => exists(path.join(parent.directory, name))) ||
      !exists(path.join(parent.directory, "attempt-01-outcome.json")) ||
      parentLedger.holds.some(item => !item.checkpoint || !exists(path.join(parent.directory, `call-${numberName(item.hold.slot)}-outcome.json`))) ||
      !same(parentLedger.holds.map(item => item.hold.stage), stages)) refuse("prepared predecessor changed or uncertain");
    const preparedBytes = read(path.join(parent.directory, "prepared-result.json")), prepared = preparedSchema.parse(JSON.parse(preparedBytes.toString("utf8")));
    if (hash(preparedBytes) !== authorization.parentPreparedResultSha256 || prepared.runSha256 !== authorization.parentRunSha256 ||
      prepared.authorizationSha256 !== parent.authorizationSha256 || prepared.nativeClaimSha256 !== authorization.nativeClaimSha256 ||
      prepared.providerLedgerSha256 !== parentLedger.sha256 || prepared.contextSha256 !== authorization.contextSha256 ||
      prepared.claimId !== local.claimId || prepared.originalId !== original.authority.original.id || hashObject(prepared.run) !== prepared.runSha256)
      refuse("rejected prepared tuple changed");
    const transitions = path.join(os.homedir(), ".local", "share", "keryx-canary-transitions");
    for (const [file, expected, role] of [[authorization.rootQualityRejectionFile, authorization.rootQualityRejectionSha256, "root"],
      [authorization.independentQualityRejectionFile, authorization.independentQualityRejectionSha256, "independent"]] as const) {
      const relative = path.relative(transitions, file);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) refuse("quality rejection must remain protected and private");
      const raw = read(file, 65_536), rejection = continuationPreparedRejectionSchema.parse(JSON.parse(raw.toString("utf8")));
      if (hash(raw) !== expected || rejection.role !== role || rejection.executorCommit !== parent.authorization.executorCommit ||
        rejection.preparedResultSha256 !== authorization.parentPreparedResultSha256 || rejection.runSha256 !== prepared.runSha256 ||
        rejection.providerLedgerSha256 !== parentLedger.sha256 || rejection.contextSha256 !== authorization.contextSha256 ||
        rejection.supplementaryInputSha256 !== authorization.supplementaryInputSha256 || rejection.nativeClaimSha256 !== authorization.nativeClaimSha256 ||
        rejection.packetSha256 !== authorization.packetSha256 || rejection.inputSemanticSha256 !== authorization.inputSemanticSha256 ||
        Date.parse(rejection.rejectedAt) < Date.parse(prepared.completedAt) || Date.parse(rejection.rejectedAt) > Date.parse(authorization.approvedAt))
        refuse("independent prepared quality rejection changed");
    }
    if (authorization.rootQualityRejectionFile === authorization.independentQualityRejectionFile ||
      authorization.rootQualityRejectionSha256 === authorization.independentQualityRejectionSha256) refuse("quality reviewers are not separately bound");
    supplement = parent.supplement;
    const held = parentLedger.holds[0], checkpoint = held.checkpoint!;
    if (held.sha256 !== authorization.parentSufficiencyHoldSha256 ||
      hash(read(path.join(parent.directory, "call-01-checkpoint.json"))) !== authorization.parentSufficiencyCheckpointSha256 ||
      checkpoint.resultSha256 !== authorization.parentSufficiencyResultSha256 || held.hold.promptSha256 !== authorization.parentSufficiencyPromptSha256)
      refuse("positive sufficiency carry changed");
    const rows = checkpoint.result.perClaim;
    if (supplement.gathered.length !== 4 || original.packet.input.targets.length !== 5 ||
      !same(original.authorization.requiredSupportedTargetIndexes, [0, 1, 2, 3, 4]) ||
      !Array.isArray(rows) || rows.length !== 5 || rows.some((row, index) => !row || typeof row !== "object" ||
        row.claim !== original.packet.input.targets[index] || typeof row.coverage !== "number" || !Number.isFinite(row.coverage) || row.coverage < 0.4 || row.coverage > 1 ||
        typeof row.supportedAnswer !== "string" || !Array.isArray(row.coveredBy) || !row.coveredBy.length ||
        row.coveredBy.some((marker: unknown) => typeof marker !== "string" || !supplement!.gathered.some(source => source.marker === marker)) ||
        !Array.isArray(row.missingRequestedParts) || row.missingRequestedParts.some((part: unknown) => typeof part !== "string" || !part.trim())))
      refuse("parent positive mandatory sufficiency changed");
    carriedSufficiency = carriedSufficiencySchema.parse({ format: "keryx-original-continuation-carried-sufficiency-v1",
      parentAuthorizationSha256: parent.authorizationSha256, parentHoldSha256: held.sha256,
      parentCheckpointSha256: authorization.parentSufficiencyCheckpointSha256, parentResultSha256: checkpoint.resultSha256,
      promptSha256: held.hold.promptSha256, contextSha256: authorization.contextSha256,
      inputBytes: held.hold.inputBytes, maximumOutputTokens: held.hold.maximumOutputTokens, result: checkpoint.result });
  }
  if (authorization.format === "keryx-original-continuation-authorization-v5") {
    const parent = readContinuationAuthorization(authorization.parentAuthorizationFile, authorization.parentAuthorizationSha256);
    if (parent.authorization.format !== "keryx-original-continuation-authorization-v4" || !parent.supplement || !parent.carriedSufficiency ||
      parent.directory !== fixedPaths(os.homedir(), 4).epochDirectory || !same(parent.original, original) || !same(parent.local, local) ||
      authorization.supplementaryInputFile !== parent.authorization.supplementaryInputFile ||
      authorization.supplementaryInputSha256 !== parent.authorization.supplementaryInputSha256 || authorization.contextSha256 !== parent.authorization.contextSha256 ||
      authorization.ownerAuthorizationSha256 === parent.authorization.ownerAuthorizationSha256)
      refuse("failed quality recovery authority changed");
    const transitions = path.join(os.homedir(), ".local", "share", "keryx-canary-transitions"),
      relative = path.relative(transitions, authorization.ownerAuthorizationFile);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) refuse("repair receipt must remain protected and private");
    const receiptRaw = read(authorization.ownerAuthorizationFile, 65_536), receipt = continuationOwnerRepairReceiptSchema.parse(JSON.parse(receiptRaw.toString("utf8")));
    if (hash(receiptRaw) !== authorization.ownerAuthorizationSha256 || receipt.recordedAt !== authorization.ownerAuthorizationReceivedAt ||
      receipt.expiresAt !== authorization.expiresAt || receipt.parentAuthorizationSha256 !== authorization.parentAuthorizationSha256 ||
      receipt.originalAuthorizationSha256 !== authorization.originalAuthorizationSha256 || receipt.nativeClaimSha256 !== authorization.nativeClaimSha256 ||
      receipt.packetSha256 !== authorization.packetSha256 || receipt.inputSemanticSha256 !== authorization.inputSemanticSha256 ||
      receipt.contextSha256 !== authorization.contextSha256) refuse("new finite owner repair receipt changed");
    const anchor = readActiveEpochAnchor(os.homedir(), epochIo(), 4), parentLedger = continuationProviderLedger(parent);
    if (!anchor || anchor.binding.authorizationFile !== parent.authorizationFile || anchor.binding.authorizationSha256 !== parent.authorizationSha256 ||
      anchor.intentSha256 !== authorization.parentAnchorIntentSha256 || anchor.activeSha256 !== authorization.parentAnchorActiveSha256 ||
      anchor.frontierSha256 !== authorization.parentAnchorFrontierSha256 || anchor.ledgerHeadSha256 !== authorization.parentLedgerHeadSha256 ||
      parentLedger.sha256 !== authorization.parentProviderLedgerSha256 || parentLedger.newModelCalls !== 2 ||
      parentLedger.combinedReservedMicroUsd !== authorization.historicalReservedMicroUsd || parentLedger.attempts.length !== 1 ||
      parentLedger.diagnostics.length !== 1 || parentLedger.diagnostics[0].attemptId !== parentLedger.attempts[0].attemptId ||
      parentLedger.diagnostics[0].diagnostic.phase !== "assemble" || parentLedger.diagnostics[0].diagnostic.category !== "quality" ||
      !same(parentLedger.holds.map(item => item.hold.stage), ["synthesize", "review"]) ||
      parentLedger.holds.some(item => !item.checkpoint || item.hold.attemptId !== parentLedger.attempts[0].attemptId) ||
      ["execution-lock.json", "prepared-result.json", "delivered.json"].some(name => exists(path.join(parent.directory, name))))
      refuse("failed quality predecessor changed or uncertain");
    for (const [name, expected] of [
      ["carried-sufficiency.json", authorization.parentCarriedSufficiencySha256],
      ["call-01.json", authorization.parentGenerationHoldSha256], ["call-01-checkpoint.json", authorization.parentGenerationCheckpointSha256],
      ["call-01-outcome.json", authorization.parentGenerationOutcomeSha256], ["call-02.json", authorization.parentReviewHoldSha256],
      ["call-02-checkpoint.json", authorization.parentReviewCheckpointSha256], ["call-02-outcome.json", authorization.parentReviewOutcomeSha256],
      ["attempt-01-outcome.json", authorization.parentAttemptOutcomeSha256], ["diagnostic-01.json", authorization.parentQualityDiagnosticSha256],
    ]) if (hash(read(path.join(/* turbopackIgnore: true */ parent.directory, name))) !== expected) refuse("acknowledged quality predecessor bytes changed");
    const outcome = attemptOutcomeSchema.parse(json(path.join(parent.directory, "attempt-01-outcome.json")));
    if (outcome.attemptId !== parentLedger.attempts[0].attemptId || outcome.outcome !== "review-completed" ||
      parentLedger.holds.some((item, index) => {
        const outcome = callOutcomeSchema.parse(json(path.join(parent.directory, `call-${numberName(index + 1)}-outcome.json`)));
        return outcome.outcome !== "normalized-json-checkpoint" || outcome.holdSha256 !== item.sha256 ||
          outcome.checkpointSha256 !== hash(read(path.join(parent.directory, `call-${numberName(index + 1)}-checkpoint.json`)));
      }) || !same(json(path.join(parent.directory, "carried-sufficiency.json")), parent.carriedSufficiency))
      refuse("failed quality predecessor acknowledgement changed");
    supplement = parent.supplement;
    carriedSufficiency = parent.carriedSufficiency;
    const closureRelative = path.relative(transitions, authorization.parentFailureClosureFile);
    if (!closureRelative || closureRelative.startsWith("..") || path.isAbsolute(closureRelative)) refuse("failure closure must remain protected and private");
    const closureRaw = read(authorization.parentFailureClosureFile, 65_536);
    if (hash(closureRaw) !== authorization.parentFailureClosureSha256) refuse("operational failure closure changed");
    validateContinuationQualityFailureClosure(JSON.parse(closureRaw.toString("utf8")), os.homedir(), {
      executorCommit: parent.authorization.executorCommit, parentAuthorizationSha256: parent.authorizationSha256,
      nativeClaimSha256: authorization.nativeClaimSha256, packetSha256: authorization.packetSha256,
      inputSemanticSha256: authorization.inputSemanticSha256, contextSha256: authorization.contextSha256,
      parentProviderLedgerSha256: authorization.parentProviderLedgerSha256, parentLedgerHeadSha256: authorization.parentLedgerHeadSha256,
      parentAnchorFrontierSha256: authorization.parentAnchorFrontierSha256,
      parentPreparedAuthorizationSha256: parent.authorization.parentAuthorizationSha256, approvedAt: authorization.approvedAt,
    }, { read, readStream: (file, maximumBytes) => read(file, maximumBytes, 0) });
  }
  if (supplier && (Date.now() >= Date.parse(authorization.expiresAt) ||
    fulfillmentExecutorCommit() !== authorization.executorCommit)) refuse("supplier authority expired or source changed");
  const directory = authorization.format === "keryx-original-continuation-authorization-v1" ? paths.parentDirectory :
    fixedPaths(os.homedir(), authorization.format === "keryx-original-continuation-authorization-v5" ? 5 :
      authorization.format === "keryx-original-continuation-authorization-v4" ? 4 :
      authorization.format === "keryx-original-continuation-authorization-v3" ? 3 : 2).epochDirectory;
  if (supplier && authorization.format === "keryx-original-continuation-authorization-v1" &&
    readLatestEpochAnchor(os.homedir(), epochIo())) refuse("parent supplier epoch superseded");
  if (supplier && authorization.format === "keryx-original-continuation-authorization-v2" &&
    readActiveEpochAnchor(os.homedir(), epochIo(), 3)) refuse("parent supplier epoch superseded");
  if (supplier && authorization.format === "keryx-original-continuation-authorization-v3" &&
    readActiveEpochAnchor(os.homedir(), epochIo(), 4)) refuse("parent supplier epoch superseded");
  if (supplier && authorization.format === "keryx-original-continuation-authorization-v4" &&
    readActiveEpochAnchor(os.homedir(), epochIo(), 5)) refuse("parent supplier epoch superseded");
  return { authorization, authorizationFile: file, authorizationSha256: expectedSha256, directory, original, local,
    ...(supplement ? { supplement } : {}), ...(carriedSufficiency ? { carriedSufficiency,
      qualityProtocol: "same-evidence-prepared-quality-v1" as const } : {}) };
}
function retainedBinding() {
  protectedPath(continuationDirectory(), true);
  const retained = retainedSchema.parse(json(path.join(continuationDirectory(), "authorization.json")));
  return readContinuationAuthorization(retained.authorizationFile, retained.authorizationSha256);
}
function requireActiveBinding(binding: ContinuationBinding) {
  if (binding.directory !== continuationDirectory()) refuse("supplier epoch is not active");
  const active = readLatestEpochAnchor(os.homedir(), epochIo());
  if (active && (active.binding.authorizationFile !== binding.authorizationFile ||
    active.binding.authorizationSha256 !== binding.authorizationSha256)) refuse("active additive authority changed");
}
function normalizeJson(value: Record<string, unknown>) {
  const visit = (item: unknown, depth: number): void => {
    if (depth > 32) refuse("normalized output depth refused");
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (const element of item) visit(element, depth + 1); return; }
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      for (const element of Object.values(item)) visit(element, depth + 1); return;
    }
    refuse("normalized output type refused");
  };
  if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse("normalized output object refused");
  visit(value, 0); const raw = canonicalJson(value);
  if (Buffer.byteLength(raw) > 500_000) refuse("normalized output byte limit refused");
  return JSON.parse(raw) as Record<string, unknown>;
}
const numberName = (value: number) => String(value).padStart(2, "0");
/** Raw-hash commitment to all grant, attempt, hold, checkpoint, outcome and fixed diagnostic bytes. */
export function continuationProviderLedger(binding = retainedBinding()) {
  const directory = binding.directory; protectedPath(directory, true);
  assertLedgerHead(directory);
  const names = fs.readdirSync(directory).sort(), entries: Array<{ name: string; sha256: string }> = [];
  const attempts = new Map<string, z.infer<typeof attemptSchema>>();
  const diagnostics: Array<z.infer<typeof diagnosticRecordSchema>> = [];
  const holds: Array<{ hold: z.infer<typeof holdSchema> | z.infer<typeof contextualHoldSchema>; sha256: string; checkpoint?: z.infer<typeof checkpointSchema> }> = [];
  const parsed = new Map<string, unknown>();
  for (const name of names) {
    if (nonLedgerNames.has(name)) { protectedPath(path.join(directory, name), false); continue; }
    const bytes = read(path.join(directory, name)); parsed.set(name, JSON.parse(bytes.toString("utf8")));
    entries.push({ name, sha256: hash(bytes) });
    if (name === "authorization.json") {
      if (!same(parsed.get(name), { format: "keryx-original-continuation-retained-authorization-v1",
        authorizationFile: binding.authorizationFile, authorizationSha256: binding.authorizationSha256 })) refuse("retained grant changed");
    } else if (name === "carried-sufficiency.json") {
      if (!isCarriedQualityAuthorization(binding.authorization) || !binding.carriedSufficiency ||
        !same(carriedSufficiencySchema.parse(parsed.get(name)), binding.carriedSufficiency)) refuse("carried sufficiency ledger changed");
    } else if (/^attempt-[0-9]{2}\.json$/.test(name)) {
      const attempt = attemptSchema.parse(parsed.get(name));
      if (attempt.attempt !== attempts.size + 1 || name !== `attempt-${numberName(attempt.attempt)}.json` ||
        attempt.authorizationSha256 !== binding.authorizationSha256 || attempt.claimId !== binding.local.claimId ||
        Date.parse(attempt.startedAt) < Date.parse(binding.authorization.approvedAt) ||
        Date.parse(attempt.startedAt) >= Date.parse(binding.authorization.expiresAt) || Date.parse(attempt.startedAt) > Date.now() ||
        attempts.has(attempt.attemptId)) refuse("attempt binding refused");
      attempts.set(attempt.attemptId, attempt);
    } else if (!/^attempt-[0-9]{2}-outcome\.json$|^call-[0-9]{2}(?:-checkpoint|-outcome)?\.json$|^diagnostic-[0-9]{2}\.json$/.test(name))
      refuse("unknown continuation ledger entry");
  }
  if (!parsed.has("authorization.json")) refuse("retained grant missing");
  if (isCarriedQualityAuthorization(binding.authorization) && !parsed.has("carried-sufficiency.json"))
    refuse("carried sufficiency ledger missing");
  for (const [name, value] of parsed) {
    if (/^call-[0-9]{2}\.json$/.test(name)) {
      const contextual = binding.authorization.format === "keryx-original-continuation-authorization-v3" || isCarriedQualityAuthorization(binding.authorization);
      const hold = (contextual ? contextualHoldSchema : holdSchema).parse(value);
      const attempt = attempts.get(hold.attemptId);
      if ((binding.authorization.format === "keryx-original-continuation-authorization-v3" || isCarriedQualityAuthorization(binding.authorization)) &&
        (!("contextSha256" in hold) || hold.contextSha256 !== binding.authorization.contextSha256)) refuse("held supplementary context changed");
      if (!attempt || hold.slot !== holds.length + 1 || name !== `call-${numberName(hold.slot)}.json` ||
        isCarriedQualityAuthorization(binding.authorization) && hold.stage === "sufficiency" ||
        hold.authorizationSha256 !== binding.authorizationSha256 || hold.claimId !== binding.local.claimId ||
        hold.packetSha256 !== binding.authorization.packetSha256 || hold.inputSemanticSha256 !== binding.authorization.inputSemanticSha256 ||
        hold.executorCommit !== binding.authorization.executorCommit || Date.parse(hold.reservedAt) < Date.parse(attempt.startedAt) ||
        Date.parse(hold.reservedAt) >= Date.parse(binding.authorization.expiresAt) || Date.parse(hold.reservedAt) > Date.now()) refuse("held model binding refused");
      holds.push({ hold, sha256: entries.find(entry => entry.name === name)!.sha256 });
    }
  }
  for (const [name, value] of parsed) {
    const call = /^call-([0-9]{2})-(checkpoint|outcome)\.json$/.exec(name);
    if (call) {
      const item = holds[Number(call[1]) - 1]; if (!item) refuse("orphan checkpoint or outcome refused");
      if (call[2] === "checkpoint") {
        const checkpoint = checkpointSchema.parse(value);
        if (checkpoint.holdSha256 !== item.sha256 || hashObject(normalizeJson(checkpoint.result)) !== checkpoint.resultSha256 ||
          Date.parse(checkpoint.completedAt) < Date.parse(item.hold.reservedAt) || Date.parse(checkpoint.completedAt) > Date.now()) refuse("checkpoint binding refused");
        item.checkpoint = checkpoint;
      } else {
        const outcome = callOutcomeSchema.parse(value), checkpointName = `call-${call[1]}-checkpoint.json`;
        if (outcome.holdSha256 !== item.sha256 || Date.parse(outcome.completedAt) < Date.parse(item.hold.reservedAt) ||
          Date.parse(outcome.completedAt) > Date.now() ||
          (outcome.outcome === "normalized-json-checkpoint" ? !parsed.has(checkpointName) ||
            outcome.checkpointSha256 !== entries.find(entry => entry.name === checkpointName)?.sha256 :
            outcome.checkpointSha256 !== null || parsed.has(checkpointName))) refuse("model outcome binding refused");
      }
    } else if (/^attempt-[0-9]{2}-outcome\.json$/.test(name)) {
      const outcome = attemptOutcomeSchema.parse(value), attempt = attempts.get(outcome.attemptId);
      if (!attempt || name !== `attempt-${numberName(attempt.attempt)}-outcome.json` ||
        Date.parse(outcome.endedAt) < Date.parse(attempt.startedAt) || Date.parse(outcome.endedAt) > Date.now()) refuse("attempt outcome binding refused");
    } else if (/^diagnostic-[0-9]{2}\.json$/.test(name)) {
      const record = diagnosticRecordSchema.parse(value);
      if (!attempts.has(record.attemptId) || Date.parse(record.recordedAt) > Date.now()) refuse("diagnostic binding refused");
      diagnostics.push(record);
    }
  }
  if (holds.length > binding.authorization.maximumNewModelCalls || attempts.size > 8 ||
    binding.authorization.historicalReservedMicroUsd + holds.length * LIMITS.modelReserveMicroUsd > binding.authorization.maximumCombinedMicroUsd ||
    !same(names, fs.readdirSync(directory).sort())) refuse("ledger changed or exceeded bounds");
  return { sha256: hashObject(entries), newModelCalls: holds.length,
    oldAdditiveModelCalls: binding.authorization.format === "keryx-original-continuation-authorization-v5" ? 16 :
      binding.authorization.format === "keryx-original-continuation-authorization-v4" ? 14 :
      binding.authorization.format === "keryx-original-continuation-authorization-v3" ? 11 :
      binding.authorization.format === "keryx-original-continuation-authorization-v2" ? 10 : 2,
    reservedMicroUsd: holds.length * LIMITS.modelReserveMicroUsd,
    combinedReservedMicroUsd: binding.authorization.historicalReservedMicroUsd + holds.length * LIMITS.modelReserveMicroUsd,
    holds, attempts: [...attempts.values()], diagnostics };
}

declare const capabilityBrand: unique symbol;
export interface ContinuationCapability { readonly [capabilityBrand]: true }
type NativeDb = FailedBusinessCanaryProofDb & Pick<KeryxDB,
  "getA2aFailedOriginalFulfillment" | "completeA2aFailedOriginalFulfillment" | "hasA2aFailedOriginalFulfillment">;
interface State { binding: ContinuationBinding; claim: A2aFulfillmentClaim; open: boolean; busy: boolean;
  attempt: z.infer<typeof attemptSchema>; nextStage: number; revocation: AbortController;
  flush: (directory: string) => void; lockSha256: string; uncertain: boolean; releaseRequested: boolean;
  rejectedThroughAttempt: number; freshSynthesis: boolean }
const capabilities = new WeakMap<ContinuationCapability, State>();
const dispatch = new AsyncLocalStorage<{ capability: ContinuationCapability; slot: number; holdSha256: string }>();
function nativeClaimMatches(binding: ContinuationBinding, claim: A2aFulfillmentClaim) {
  return hashObject(claim) === binding.authorization.nativeClaimSha256 && claim.claimId === binding.local.claimId &&
    same(claim.authority, binding.original.authority) && claim.claimedAt === binding.local.claimedAt;
}
function validateRejectedParentPrepared(binding: ContinuationBinding, claim: A2aFulfillmentClaim) {
  if (binding.authorization.format === "keryx-original-continuation-authorization-v5") {
    const parent = readContinuationAuthorization(binding.authorization.parentAuthorizationFile, binding.authorization.parentAuthorizationSha256);
    validateRejectedParentPrepared(parent, claim);
    return;
  }
  if (binding.authorization.format !== "keryx-original-continuation-authorization-v4") return;
  const parent = readContinuationAuthorization(binding.authorization.parentAuthorizationFile, binding.authorization.parentAuthorizationSha256);
  const prepared = preparedSchema.parse(json(path.join(parent.directory, "prepared-result.json")));
  const completion: A2aFulfillmentCompletion = { claimId: prepared.claimId, originalId: prepared.originalId,
    runSha256: prepared.runSha256, providerLedgerSha256: prepared.providerLedgerSha256, completedAt: prepared.completedAt,
    run: prepared.run as QueryRun };
  validateFulfilledQueryRun(completion.run, claim, completion, nativeEvidenceCapability(parent, claim, completion.run));
  assertPreparedQuality(parent, completion.run);
}
/** Native observation is also used while this process owns a pending activation
 * intent. Only the public status path can demand a complete active frontier. */
async function inspectContinuationProof(db: NativeDb, file: string, expectedSha256: string, inspectActiveFrontier: boolean) {
  const frontier = inspectActiveFrontier ? readLatestEpochAnchor(os.homedir(), epochIo()) : null;
  const binding = readContinuationAuthorization(file, expectedSha256);
  const record = await db.getA2aFailedOriginalFulfillment?.(binding.original.authority.original.id);
  if (!record || !nativeClaimMatches(binding, record.claim)) refuse("fresh native retained claim changed");
  validateRejectedParentPrepared(binding, record.claim);
  if (record.completion === null) {
    const failure = await verifyFailedBusinessCanary(db);
    if (failure.originalEvidenceSha256 !== binding.authorization.originalEvidenceSha256) refuse("fresh native failure changed");
  } else {
    let capability: ReturnType<typeof nativeEvidenceCapability> = undefined;
    if (binding.supplement) {
      const raw = preparedSchema.parse(json(path.join(binding.directory, "prepared-result.json")));
      if (raw.authorizationSha256 !== binding.authorizationSha256 || raw.nativeClaimSha256 !== binding.authorization.nativeClaimSha256 ||
        raw.contextSha256 !== binding.supplement.contextSha256 || raw.claimId !== record.completion.claimId ||
        raw.runSha256 !== record.completion.runSha256 || raw.providerLedgerSha256 !== record.completion.providerLedgerSha256)
        refuse("completed supplementary native proof changed");
      const completion: A2aFulfillmentCompletion = { claimId: raw.claimId, originalId: raw.originalId, runSha256: raw.runSha256,
        providerLedgerSha256: raw.providerLedgerSha256, completedAt: raw.completedAt, run: raw.run as QueryRun };
      capability = nativeEvidenceCapability(binding, record.claim, completion.run);
      validateFulfilledQueryRun(completion.run, record.claim, completion, capability);
      assertPreparedQuality(binding, completion.run);
    }
    if (await (capability ? db.hasA2aFailedOriginalFulfillment?.(binding.original.authority, capability) :
      db.hasA2aFailedOriginalFulfillment?.(binding.original.authority)) !== true) refuse("native completion proof unavailable");
  }
  const directory = binding.directory; let ledger = null;
  if (exists(directory)) {
    protectedPath(directory, true);
    if (fs.readdirSync(directory).length) ledger = continuationProviderLedger(binding);
  }
  const sourceBound = fulfillmentExecutorCommit() === binding.authorization.executorCommit;
  if (inspectActiveFrontier && !same(frontier, readLatestEpochAnchor(os.homedir(), epochIo())))
    refuse("active frontier changed during observation");
  return { binding, claim: record.claim, newModelCalls: ledger?.newModelCalls ?? 0,
    combinedReservedMicroUsd: ledger?.combinedReservedMicroUsd ?? binding.authorization.historicalReservedMicroUsd,
    supplierWindowLive: sourceBound && Date.now() < Date.parse(binding.authorization.expiresAt),
    executionIntentRetained: exists(path.join(directory, "execution-lock.json")),
    prepared: exists(path.join(directory, "prepared-result.json")),
    deliveredMarker: exists(path.join(directory, "delivered.json")), nativeCompleted: record.completion !== null,
    providerRequests: 0, payments: 0 };
}
/** Private observation/preflight verifies the external latest frontier even when
 * an explicit grant file is supplied. It cannot report a reset consumption count. */
export async function inspectOriginalContinuation(db: NativeDb, file: string, expectedSha256: string) {
  return inspectContinuationProof(db, file, expectedSha256, true);
}
/** Explicit one-time additive episode activation. It changes no native claim,
 * parent journal, payment or supplier state; uncertainty permanently blocks fallback. */
export async function activateOriginalContinuationEpoch(db: NativeDb, file: string, expectedSha256: string, flush = syncDirectory) {
  const binding = readContinuationAuthorization(file, expectedSha256, true), authorization = binding.authorization;
  if (authorization.format === "keryx-original-continuation-authorization-v1") refuse("epoch activation requires separate authority");
  const fields = authorization.format === "keryx-original-continuation-authorization-v5"
    ? z.object(continuationFailedQualityEpochAuthorizationFields).parse(authorization) : authorization.format === "keryx-original-continuation-authorization-v4"
    ? z.object(continuationPreparedEpochAuthorizationFields).parse(authorization) : authorization.format === "keryx-original-continuation-authorization-v3"
    ? z.object(continuationSupplementEpochAuthorizationFields).parse(authorization)
    : z.object(continuationEpochAuthorizationFields).parse(authorization);
  const authority: ContinuationEpochBinding = {
    ...fields, authorizationFile: file, authorizationSha256: expectedSha256,
    originalAuthorizationSha256: authorization.originalAuthorizationSha256, nativeClaimSha256: authorization.nativeClaimSha256,
    inputSemanticSha256: authorization.inputSemanticSha256, packetSha256: authorization.packetSha256,
    executionHostSha256: authorization.executionHostSha256, executorCommit: authorization.executorCommit,
    ownerAuthorizationSha256: authorization.ownerAuthorizationSha256, ownerAuthorizationReceivedAt: authorization.ownerAuthorizationReceivedAt,
    approvedAt: authorization.approvedAt, expiresAt: authorization.expiresAt, maximumDurationMs: authorization.maximumDurationMs };
  const result = await activateEpochAnchor(os.homedir(), authority, epochIo(flush), {
    async validateAuthority() {
      const current = readContinuationAuthorization(file, expectedSha256, true);
      if (!same(current, binding)) refuse("epoch authority changed during activation");
      const proof = await inspectContinuationProof(db, file, expectedSha256, false);
      if (!proof.supplierWindowLive || proof.nativeCompleted || proof.prepared || proof.deliveredMarker ||
        proof.executionIntentRetained || proof.newModelCalls !== 0) refuse("fresh native epoch activation refused");
    },
    initializeJournal(paths) {
      epochIo(flush).ensureDirectory(paths.epochDirectory);
      retain("authorization.json", { format: "keryx-original-continuation-retained-authorization-v1",
        authorizationFile: file, authorizationSha256: expectedSha256 }, flush, paths.epochDirectory);
      if (binding.carriedSufficiency) retain("carried-sufficiency.json", binding.carriedSufficiency, flush, paths.epochDirectory);
    },
  });
  requireActiveBinding(binding);
  return { activated: true, authorizationSha256: expectedSha256, parentProviderLedgerSha256: authorization.parentProviderLedgerSha256,
    activeSha256: result.activeSha256, newModelCalls: 0, combinedReservedMicroUsd: authorization.historicalReservedMicroUsd,
    nativeClaimChanged: false, providerRequests: 0, payments: 0 };
}
/** A new additive attempt uses the existing permanent native claim; it never reclaims or requeues it. */
export async function beginOriginalContinuation(db: NativeDb, file: string, expectedSha256: string, flush = syncDirectory) {
  const binding = readContinuationAuthorization(file, expectedSha256, true);
  requireActiveBinding(binding);
  const failure = await verifyFailedBusinessCanary(db), record = await db.getA2aFailedOriginalFulfillment?.(binding.original.authority.original.id);
  if (!record || record.completion !== null || !nativeClaimMatches(binding, record.claim) ||
    failure.originalEvidenceSha256 !== binding.authorization.originalEvidenceSha256) refuse("fresh native retained claim changed");
  const directory = continuationDirectory(); protectedPath(directory, true);
  if (exists(path.join(directory, "prepared-result.json")) || exists(path.join(directory, "delivered.json"))) refuse("execution already prepared");
  if (exists(path.join(directory, "authorization.json"))) {
    const prior = continuationProviderLedger(binding);
    if (prior.newModelCalls >= binding.authorization.maximumNewModelCalls || prior.attempts.length >= 8) refuse("supplier allowance exhausted");
    if (binding.qualityProtocol && binding.authorization.maximumNewModelCalls - prior.newModelCalls < 2)
      refuse("fresh quality generation and review require two remaining holds");
    if (prior.diagnostics.some(item => item.diagnostic.phase === "sufficiency" && item.diagnostic.category === "quality"))
      refuse("unchanged context has acknowledged insufficient mandatory evidence");
  }
  // A retained lock is uncertainty, never a PID/age-based takeover opportunity.
  const lock = { format: "keryx-original-continuation-lock-v1", authorizationSha256: expectedSha256,
    attemptId: randomBytes(32).toString("hex"), startedAt: now() };
  retain("execution-lock.json", lock, flush);
  const lockSha256 = hash(read(path.join(directory, "execution-lock.json")));
  {
    if (!exists(path.join(directory, "authorization.json"))) {
      if (!same(fs.readdirSync(directory).sort(), ["execution-lock.json"])) refuse("unbound pre-existing continuation ledger");
      retain("authorization.json", { format: "keryx-original-continuation-retained-authorization-v1",
        authorizationFile: file, authorizationSha256: expectedSha256 }, flush);
    }
    const ledger = continuationProviderLedger(binding);
    if (ledger.newModelCalls >= binding.authorization.maximumNewModelCalls || ledger.attempts.length >= 8) refuse("supplier allowance exhausted");
    for (const attempt of ledger.attempts) if (!exists(path.join(directory, `attempt-${numberName(attempt.attempt)}-outcome.json`))) refuse("previous attempt acknowledgement uncertain");
    // A quality-rejected pair must never become reusable again merely because a
    // subsequent refresh failed in transport. Keep the acknowledged diagnostic
    // barrier across all later attempts; every prior hold remains consumed.
    const rejectedThroughAttempt = Math.max(0, ...ledger.diagnostics
      .filter(record => (record.diagnostic.phase === "assemble" || record.diagnostic.phase === "synthesize") && record.diagnostic.category === "quality")
      .map(record => ledger.attempts.find(attempt => attempt.attemptId === record.attemptId)!.attempt));
    const attempt = attemptSchema.parse({ format: "keryx-original-continuation-attempt-v1", authorizationSha256: expectedSha256,
      claimId: record.claim.claimId, attempt: ledger.attempts.length + 1, attemptId: lock.attemptId, startedAt: lock.startedAt });
    retain(`attempt-${numberName(attempt.attempt)}.json`, attempt, flush);
    readContinuationAuthorization(file, expectedSha256, true); continuationProviderLedger(binding);
    const capability = Object.freeze({}) as ContinuationCapability;
    capabilities.set(capability, { binding: { ...structuredClone(binding), ...(binding.supplement ? { supplement: binding.supplement } : {}) },
      claim: structuredClone(record.claim), open: true, busy: false, attempt, nextStage: 0,
      revocation: new AbortController(), flush, lockSha256, uncertain: false, releaseRequested: false,
      rejectedThroughAttempt, freshSynthesis: false });
    return { capability, binding, claim: record.claim };
  }
}
function lockMatches(state: State) {
  if (hash(read(path.join(continuationDirectory(), "execution-lock.json"))) !== state.lockSha256) refuse("execution lock changed");
}
function endAttempt(state: State, outcome: z.infer<typeof attemptOutcomeSchema>["outcome"]) {
  const name = `attempt-${numberName(state.attempt.attempt)}-outcome.json`;
  if (!exists(path.join(continuationDirectory(), name))) {
    state.uncertain = true;
    retain(name, { format: "keryx-original-continuation-attempt-outcome-v1",
      attemptId: state.attempt.attemptId, endedAt: now(), outcome }, state.flush);
    state.uncertain = false;
  }
}
function releaseSettledLock(state: State) {
  if (state.busy || state.uncertain) return;
  if (!exists(path.join(continuationDirectory(), "execution-lock.json"))) return;
  lockMatches(state);
  if (!exists(path.join(continuationDirectory(), `attempt-${numberName(state.attempt.attempt)}-outcome.json`))) refuse("attempt closure missing");
  fs.unlinkSync(path.join(continuationDirectory(), "execution-lock.json")); state.flush(continuationDirectory());
}
export function closeContinuationCapability(capability: ContinuationCapability) {
  const state = capabilities.get(capability); if (!state) return;
  state.open = false; state.revocation.abort(); state.releaseRequested = true;
  if (!state.busy && !state.uncertain) { endAttempt(state, "revoked"); releaseSettledLock(state); }
}
export function recordContinuationDiagnostic(capability: ContinuationCapability, diagnostic: z.infer<typeof diagnosticSchema>) {
  const state = capabilities.get(capability);
  if (!state || state.uncertain || state.releaseRequested || exists(path.join(continuationDirectory(), "prepared-result.json"))) refuse("diagnostic capability unavailable");
  lockMatches(state);
  const value = diagnosticSchema.parse(diagnostic), ledger = continuationProviderLedger(state.binding);
  if (value.phase === "assemble" && value.category === "quality" && state.nextStage !== 3)
    refuse("quality diagnostic requires completed independent review");
  if (value.phase === "sufficiency" && value.category === "quality" && state.nextStage !== 1)
    refuse("sufficiency quality diagnostic requires an acknowledged assessment");
  if (value.phase === "synthesize" && value.category === "quality") {
    const held = ledger.holds.at(-1);
    if (!held || held.hold.stage !== "synthesize" || held.hold.attemptId !== state.attempt.attemptId ||
      (state.nextStage !== 1 && state.nextStage !== 2) ||
      !exists(path.join(continuationDirectory(), `call-${numberName(held.hold.slot)}-outcome.json`)))
      refuse("generation quality diagnostic requires an acknowledged generation hold");
    const outcome = callOutcomeSchema.parse(json(path.join(continuationDirectory(), `call-${numberName(held.hold.slot)}-outcome.json`)));
    if (outcome.holdSha256 !== held.sha256 || (state.nextStage === 1 ?
      outcome.outcome !== "failed-no-reusable-output" || held.checkpoint !== undefined :
      outcome.outcome !== "normalized-json-checkpoint" || !held.checkpoint))
      refuse("generation quality acknowledgement changed");
  }
  const number = fs.readdirSync(continuationDirectory()).filter(name => /^diagnostic-[0-9]{2}\.json$/.test(name)).length + 1;
  if (number > 32 || ledger.attempts.every(item => item.attemptId !== state.attempt.attemptId)) refuse("diagnostic limit refused");
  retain(`diagnostic-${numberName(number)}.json`, { format: "keryx-original-continuation-diagnostic-v1",
    attemptId: state.attempt.attemptId, recordedAt: now(), diagnostic: value }, state.flush);
}
/** Final dispatch permission is checked after the durable hold and all asynchronous preflight. */
export function assertContinuationSupplierAdmission(capability: ContinuationCapability) {
  const state = capabilities.get(capability), context = dispatch.getStore();
  if (!state?.open || state.revocation.signal.aborted || !state.busy || context?.capability !== capability) refuse("supplier capability revoked");
  lockMatches(state);
  const current = readContinuationAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256, true);
  const ledger = continuationProviderLedger(current), held = ledger.holds[context.slot - 1];
  if (!held || held.sha256 !== context.holdSha256 || held.hold.attemptId !== state.attempt.attemptId ||
    exists(path.join(continuationDirectory(), `call-${numberName(context.slot)}-outcome.json`)) ||
    exists(path.join(continuationDirectory(), "prepared-result.json"))) refuse("dispatch reservation changed");
}
export function continuationSupplierSignal(capability: ContinuationCapability, timeoutMs: number) {
  assertContinuationSupplierAdmission(capability); const state = capabilities.get(capability)!;
  const remaining = Date.parse(state.binding.authorization.expiresAt) - Date.now();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || remaining < 1) refuse("supplier deadline exhausted");
  return AbortSignal.any([state.revocation.signal, AbortSignal.timeout(Math.min(timeoutMs, remaining))]);
}
/** Original-only quote enrollment requires the actual live quality-episode
 * capability. This inspection grants no supplier dispatch or serialized authority. */
export function continuationQualityProtocol(capability: ContinuationCapability, expectedContextSha256?: string) {
  const state = capabilities.get(capability);
  if (!state?.open || state.uncertain || state.revocation.signal.aborted) refuse("quality capability unavailable");
  lockMatches(state);
  const current = readContinuationAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256, true);
  requireActiveBinding(current);
  if (!same(current, state.binding)) refuse("quality authority changed");
  if (expectedContextSha256 !== undefined && current.supplement?.contextSha256 !== expectedContextSha256)
    refuse("quality evidence context changed");
  return current.qualityProtocol;
}
declare const qualityEvidenceBrand: unique symbol;
export interface ContinuationQualityEvidenceCapability { readonly [qualityEvidenceBrand]: true }
const qualityEvidence = new WeakMap<ContinuationQualityEvidenceCapability, { binding: ContinuationBinding;
  supplier?: ContinuationCapability; claimSha256?: string; runSha256?: string; readonlyContext?: true }>();
/** Supplier enrollment and historical evidence verification use distinct tokens.
 * Neither token is serializable dispatch or payment authority. */
export function continuationQualityEvidenceCapability(supplier: ContinuationCapability) {
  if (!continuationQualityProtocol(supplier)) return undefined;
  const token = Object.freeze({}) as ContinuationQualityEvidenceCapability;
  qualityEvidence.set(token, { binding: capabilities.get(supplier)!.binding, supplier });
  return token;
}
/** Read-only preflight may enroll the unchanged evidence after native observation.
 * Full parent/rejection/claim bindings are re-read; this does not require or grant
 * an open supplier window, active execution lock or a new model reservation. */
export function continuationReadOnlyQualityEvidenceCapability(binding: ContinuationBinding, claim: A2aFulfillmentClaim) {
  const current = readContinuationAuthorization(binding.authorizationFile, binding.authorizationSha256);
  if (!current.qualityProtocol || !same(current, binding) || !nativeClaimMatches(current, claim))
    refuse("readonly quality evidence tuple changed");
  validateRejectedParentPrepared(current, claim);
  const token = Object.freeze({}) as ContinuationQualityEvidenceCapability;
  qualityEvidence.set(token, { binding: current, claimSha256: hashObject(claim), readonlyContext: true });
  return token;
}
export function continuationQualityEvidenceProtocol(token: ContinuationQualityEvidenceCapability, expectedContextSha256: string) {
  const state = qualityEvidence.get(token);
  if (!state || state.binding.supplement?.contextSha256 !== expectedContextSha256) refuse("quality evidence capability unavailable");
  if (state.supplier) return continuationQualityProtocol(state.supplier, expectedContextSha256);
  const current = readContinuationAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256);
  if (!state.claimSha256 || (!state.runSha256 && !state.readonlyContext) || !current.qualityProtocol || !same(current, state.binding))
    refuse("historical quality evidence authority changed");
  return current.qualityProtocol;
}
/** Exact successful normalized checkpoints are reusable. Acknowledged quality failures
 * invalidate their generation/review prefix, and fresh generation gets a fresh review.
 * Failed/unknown and superseded holds remain consumed and immutable. */
export async function continuationModel(capability: ContinuationCapability, stage: ContinuationStage,
  system: string, user: string, maximumOutputTokens: number, action: () => Promise<Record<string, unknown>>) {
  const state = capabilities.get(capability);
  if (!state?.open || state.busy || state.uncertain || stages[state.nextStage] !== stage) refuse("opaque capability or stage refused");
  lockMatches(state); readContinuationAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256, true);
  const inputBytes = Buffer.byteLength(system + " Respond with a single JSON object." + user);
  if (inputBytes < 1 || inputBytes > LIMITS.maximumInputBytes || !Number.isSafeInteger(maximumOutputTokens) ||
    maximumOutputTokens < 1 || maximumOutputTokens > LIMITS.maximumOutputTokens) refuse("model input/output limit exceeded");
  const promptSha256 = hashObject({ stage, system, user, maximumOutputTokens });
  const ledger = continuationProviderLedger(state.binding);
  if (isCarriedQualityAuthorization(state.binding.authorization) && stage === "sufficiency") {
    const carried = state.binding.carriedSufficiency;
    if (!carried || carried.promptSha256 !== promptSha256 || carried.inputBytes !== inputBytes || carried.maximumOutputTokens !== maximumOutputTokens ||
      !same(json(path.join(continuationDirectory(), "carried-sufficiency.json")), carried)) refuse("sufficiency carry prompt or semantic input changed");
    state.nextStage++;
    return structuredClone(carried.result);
  }
  const reusable = isCarriedQualityAuthorization(state.binding.authorization) ||
    stage === "review" && state.freshSynthesis ? undefined : [...ledger.holds].reverse().find(item =>
    item.hold.stage === stage && item.hold.promptSha256 === promptSha256 && item.checkpoint &&
    (stage === "sufficiency" || ledger.attempts.find(attempt => attempt.attemptId === item.hold.attemptId)!.attempt > state.rejectedThroughAttempt) &&
    exists(path.join(continuationDirectory(), `call-${numberName(item.hold.slot)}-outcome.json`)));
  if (reusable?.checkpoint) {
    state.nextStage++;
    if (stage === "review") endAttempt(state, "review-completed");
    return structuredClone(reusable.checkpoint.result);
  }
  if (ledger.newModelCalls >= state.binding.authorization.maximumNewModelCalls) refuse("supplier allowance exhausted");
  const slot = ledger.newModelCalls + 1, stem = `call-${numberName(slot)}`;
  const contextual = state.binding.authorization.format === "keryx-original-continuation-authorization-v3" || isCarriedQualityAuthorization(state.binding.authorization);
  const hold = (contextual ? contextualHoldSchema : holdSchema).parse({ format: "keryx-original-continuation-model-hold-v1", authorizationSha256: state.binding.authorizationSha256,
    claimId: state.claim.claimId, attemptId: state.attempt.attemptId, slot, stage, promptSha256,
    packetSha256: state.binding.authorization.packetSha256, inputSemanticSha256: state.binding.authorization.inputSemanticSha256,
    executorCommit: state.binding.authorization.executorCommit, reservedAt: now(), reserveMicroUsd: LIMITS.modelReserveMicroUsd,
    inputBytes, maximumOutputTokens, outcome: "held-regardless-of-provider-outcome",
    ...(contextual ? { contextSha256: state.binding.supplement!.contextSha256 } : {}) });
  // Publish uncertainty before attempting durable reservation; a failed fsync never grants a retry.
  state.busy = true; state.uncertain = true;
  retain(`${stem}.json`, hold, state.flush);
  const holdSha256 = hash(read(path.join(continuationDirectory(), `${stem}.json`)));
  state.uncertain = false;
  try {
    const result = await dispatch.run({ capability, slot, holdSha256 }, async () => {
      assertContinuationSupplierAdmission(capability);
      const value = await action();
      if (!state.open || state.revocation.signal.aborted || Date.now() >= Date.parse(state.binding.authorization.expiresAt)) refuse("supplier output after revocation or expiry");
      return normalizeJson(value);
    });
    state.uncertain = true;
    retain(`${stem}-checkpoint.json`, { format: "keryx-original-continuation-checkpoint-v1", holdSha256,
      resultSha256: hashObject(result), completedAt: now(), result }, state.flush);
    retain(`${stem}-outcome.json`, { format: "keryx-original-continuation-model-outcome-v1", holdSha256,
      checkpointSha256: hash(read(path.join(continuationDirectory(), `${stem}-checkpoint.json`))), completedAt: now(),
      outcome: "normalized-json-checkpoint" }, state.flush);
    state.uncertain = false; state.nextStage++;
    if (stage === "synthesize") state.freshSynthesis = true;
    if (stage === "review") endAttempt(state, "review-completed");
    continuationProviderLedger(state.binding);
    return result;
  } catch (error) {
    if (!state.uncertain) {
      state.uncertain = true;
      retain(`${stem}-outcome.json`, { format: "keryx-original-continuation-model-outcome-v1", holdSha256,
        checkpointSha256: null, completedAt: now(), outcome: "failed-no-reusable-output" }, state.flush);
      state.uncertain = false; endAttempt(state, "failed");
    }
    state.open = false; state.revocation.abort();
    throw error;
  } finally {
    state.busy = false;
    if (!state.open && !state.uncertain && state.releaseRequested) releaseSettledLock(state);
  }
}
function assertPreparedQuality(binding: ContinuationBinding, run: QueryRun) {
  if (binding.qualityProtocol && (run.originalFulfillment?.format !== "keryx-a2a-original-fulfillment-result-v2" ||
    run.originalFulfillment.qualityProtocol !== binding.qualityProtocol))
    refuse("prepared quality protocol changed");
  const statements = run.originalFulfillment?.statements;
  if (!statements?.length || !binding.original.authorization.requiredSupportedTargetIndexes.every(index =>
    statements.some(statement => statement.claimIndex === index) && (run.claimCoverage?.[index]?.coverage ?? 0) >= 0.4) ||
    !run.evidence?.filter(item => item.qualifiesForAnswer).every(item => statements.some(statement => statement.claimIndex === item.claimIndex)))
    refuse("prepared result lacks reviewed required support");
  if (binding.supplement) assertSupplementaryRunBinding(run, binding.supplement);
}
function nativeEvidenceCapability(binding: ContinuationBinding, claim: A2aFulfillmentClaim, run: QueryRun) {
  if (!binding.supplement) return undefined;
  let token: ContinuationQualityEvidenceCapability | undefined;
  if (binding.qualityProtocol) {
    if (!nativeClaimMatches(binding, claim) || run.originalFulfillment?.format !== "keryx-a2a-original-fulfillment-result-v2" ||
      run.originalFulfillment.qualityProtocol !== binding.qualityProtocol ||
      !same(readContinuationAuthorization(binding.authorizationFile, binding.authorizationSha256), binding))
      refuse("native quality evidence tuple changed");
    validateRejectedParentPrepared(binding, claim);
    token = Object.freeze({}) as ContinuationQualityEvidenceCapability;
    qualityEvidence.set(token, { binding, claimSha256: hashObject(claim), runSha256: hashObject(run) });
  }
  return fulfillmentEvidenceCapability(binding.supplement, claim, run, token);
}
export function prepareContinuationResult(capability: ContinuationCapability, run: QueryRun) {
  const state = capabilities.get(capability);
  if (!state?.open || state.busy || state.uncertain || state.nextStage !== 3) refuse("complete reviewed result unavailable");
  lockMatches(state);
  const current = readContinuationAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256);
  if (!same(current, state.binding) || fulfillmentExecutorCommit() !== state.binding.authorization.executorCommit)
    refuse("prepared source or authority changed");
  const ledger = continuationProviderLedger(state.binding);
  const completion: A2aFulfillmentCompletion = { claimId: state.claim.claimId, originalId: state.claim.authority.original.id,
    runSha256: hashObject(run), providerLedgerSha256: ledger.sha256, completedAt: now(), run };
  validateFulfilledQueryRun(run, state.claim, completion, nativeEvidenceCapability(state.binding, state.claim, run));
  assertPreparedQuality(state.binding, run);
  state.uncertain = true;
  retain("prepared-result.json", { format: "keryx-original-continuation-prepared-result-v1",
    authorizationSha256: state.binding.authorizationSha256, nativeClaimSha256: state.binding.authorization.nativeClaimSha256, ...completion,
    ...(state.binding.supplement ? { contextSha256: state.binding.supplement.contextSha256 } : {}) }, state.flush);
  state.uncertain = false; closeContinuationCapability(capability);
  return completion;
}
/** Read-only prepared recovery never confers supplier permission, including after expiry/crash. */
export async function verifyPreparedContinuation(db: NativeDb, file?: string, expectedSha256?: string) {
  const binding = file && expectedSha256 ? readContinuationAuthorization(file, expectedSha256) : retainedBinding();
  const ledger = continuationProviderLedger(binding), record = await db.getA2aFailedOriginalFulfillment?.(binding.original.authority.original.id);
  if (!record || !nativeClaimMatches(binding, record.claim)) refuse("native retained claim changed");
  const bytes = read(path.join(continuationDirectory(), "prepared-result.json")), raw = preparedSchema.parse(JSON.parse(bytes.toString("utf8")));
  const completion: A2aFulfillmentCompletion = { claimId: raw.claimId, originalId: raw.originalId, runSha256: raw.runSha256,
    providerLedgerSha256: raw.providerLedgerSha256, completedAt: raw.completedAt, run: raw.run as QueryRun };
  if (raw.authorizationSha256 !== binding.authorizationSha256 || raw.nativeClaimSha256 !== binding.authorization.nativeClaimSha256 ||
    raw.providerLedgerSha256 !== ledger.sha256 || raw.contextSha256 !== binding.supplement?.contextSha256 ||
    !ledger.holds.some(item => item.hold.stage === "review" && item.checkpoint)) refuse("prepared ledger changed");
  validateFulfilledQueryRun(completion.run, record.claim, completion, nativeEvidenceCapability(binding, record.claim, completion.run));
  assertPreparedQuality(binding, completion.run);
  return { binding, claim: record.claim, completion, preparedResultSha256: hash(bytes) };
}
/** Complete only the same permanent claim, with exact digest review and fresh native proof. */
export async function completePreparedContinuation(db: NativeDb, expectedPreparedSha256: string, flush = syncDirectory) {
  const before = await verifyPreparedContinuation(db);
  if (!digest.safeParse(expectedPreparedSha256).success || before.preparedResultSha256 !== expectedPreparedSha256) refuse("reviewed prepared-result digest changed");
  const capability = nativeEvidenceCapability(before.binding, before.claim, before.completion.run);
  const completed = capability ? await db.completeA2aFailedOriginalFulfillment?.(before.completion, capability) :
    await db.completeA2aFailedOriginalFulfillment?.(before.completion);
  const has = () => capability ? db.hasA2aFailedOriginalFulfillment?.(before.binding.original.authority, capability) :
    db.hasA2aFailedOriginalFulfillment?.(before.binding.original.authority);
  if (completed !== true || await has() !== true) refuse("native delivery acknowledgement uncertain");
  const after = await verifyPreparedContinuation(db);
  if (!same(before, after) || await has() !== true) refuse("fresh native delivery proof changed");
  const authorization = before.binding.authorization;
  const marker = deliverySchema.parse({ format: "keryx-original-continuation-delivered-v1",
    authorizationSha256: before.binding.authorizationSha256, originalAuthorizationSha256: authorization.originalAuthorizationSha256,
    nativeClaimSha256: authorization.nativeClaimSha256, policySha256: authorization.policySha256,
    failedClosureSha256: authorization.failedClosureSha256, originalEvidenceSha256: authorization.originalEvidenceSha256,
    originalProviderLedgerSha256: authorization.originalProviderLedgerSha256,
    originalFulfillmentProviderLedgerSha256: authorization.originalFulfillmentProviderLedgerSha256,
    claimId: before.claim.claimId, runSha256: before.completion.runSha256, providerLedgerSha256: before.completion.providerLedgerSha256,
    preparedResultSha256: before.preparedResultSha256, completedAt: before.completion.completedAt,
    outcome: "verified-fulfilled-original", admissionPaused: false, paidDeliveryObligation: "resolved", deliveryCompleted: true,
    refunded: false, noNewInboundPayment: true });
  const file = path.join(continuationDirectory(), "delivered.json");
  if (!exists(file)) retain("delivered.json", marker, flush);
  if (!same(json(file), marker) || await has() !== true) refuse("delivery marker acknowledgement uncertain");
  return marker;
}
/** Identifier-free public projection of the separate fresh-native delivery proof. */
export function retainedContinuationDeliveryResolution(old: RetainedFailedCanaryAuthority) {
  const directory = continuationDirectory();
  if (!exists(directory)) return null;
  protectedPath(directory, true); if (!exists(path.join(directory, "delivered.json"))) return null;
  const binding = retainedBinding(), marker = deliverySchema.parse(json(path.join(directory, "delivered.json")));
  const ledger = continuationProviderLedger(binding), bytes = read(path.join(directory, "prepared-result.json"));
  const prepared = preparedSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (prepared.contextSha256 !== binding.supplement?.contextSha256) refuse("delivered supplementary context changed");
  if (binding.supplement) assertSupplementaryRunBinding(prepared.run as QueryRun, binding.supplement);
  if (marker.authorizationSha256 !== binding.authorizationSha256 || marker.originalAuthorizationSha256 !== binding.original.authorizationSha256 ||
    marker.nativeClaimSha256 !== binding.authorization.nativeClaimSha256 || marker.policySha256 !== old.policySha256 ||
    marker.failedClosureSha256 !== old.failedClosureSha256 || marker.originalEvidenceSha256 !== old.originalEvidenceSha256 ||
    marker.originalProviderLedgerSha256 !== old.originalProviderLedgerSha256 ||
    marker.originalFulfillmentProviderLedgerSha256 !== fulfillmentProviderLedger(binding.original).sha256 ||
    marker.claimId !== binding.local.claimId || prepared.claimId !== binding.local.claimId ||
    prepared.originalId !== binding.original.authority.original.id || marker.runSha256 !== prepared.runSha256 ||
    marker.providerLedgerSha256 !== prepared.providerLedgerSha256 || marker.providerLedgerSha256 !== ledger.sha256 ||
    marker.preparedResultSha256 !== hash(bytes) || marker.completedAt !== prepared.completedAt || hashObject(prepared.run) !== marker.runSha256)
    refuse("delivered resolution changed");
  return { outcome: marker.outcome, admissionPaused: marker.admissionPaused, paidDeliveryObligation: marker.paidDeliveryObligation,
    deliveryCompleted: marker.deliveryCompleted, refunded: marker.refunded, noNewInboundPayment: marker.noNewInboundPayment };
}
