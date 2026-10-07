import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { businessCanaryHostIdentity, verifyFailedBusinessCanary,
  type FailedBusinessCanaryProofDb, type RetainedFailedCanaryAuthority } from "./canary-policy";
import { fulfillmentDirectory, fulfillmentExecutorCommit, fulfillmentProviderLedger,
  readRetainedFulfillmentBinding, readRetainedFulfillmentClaim } from "./fulfillment-policy";
import { ORIGINAL_FULFILLMENT_LIMITS as LIMITS, fulfillmentSha256 as hash,
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
export const continuationAuthorizationSchema = z.object({
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
}).strict().refine(value => Date.parse(value.ownerAuthorizationReceivedAt) <= Date.parse(value.approvedAt) &&
  Date.parse(value.approvedAt) < Date.parse(value.expiresAt) &&
  Date.parse(value.expiresAt) - Date.parse(value.ownerAuthorizationReceivedAt) <= value.maximumDurationMs,
"Continuation outside explicit owner window");
export type ContinuationAuthorization = z.infer<typeof continuationAuthorizationSchema>;
export function continuationDirectory() { return path.join(os.homedir(), ".local", "share", "keryx-business-canary-continuation"); }
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
function read(file: string, maximumBytes = 1_000_000) {
  protectedPath(file, false); const before = fs.lstatSync(file, { bigint: true });
  const signature = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs,
    stat.ctimeNs, stat.uid, stat.gid, stat.mode, stat.nlink].join(":");
  if (before.size < BigInt(1) || before.size > BigInt(maximumBytes)) refuse("protected file byte limit refused");
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
const nonLedgerNames = new Set(["execution-lock.json", "ledger-head.json", "prepared-result.json", "delivered.json"]);
function rawEntries() {
  return fs.readdirSync(continuationDirectory()).sort().filter(name => !nonLedgerNames.has(name))
    .map(name => ({ name, sha256: hash(read(path.join(continuationDirectory(), name))) }));
}
function assertLedgerHead() {
  const directory = continuationDirectory(), file = path.join(directory, "ledger-head.json");
  const entries = rawEntries();
  if (!exists(file)) {
    if (entries.length) refuse("durable ledger head missing");
    return null;
  }
  const head = z.object({ format: z.literal("keryx-original-continuation-ledger-head-v1"),
    entries: z.array(z.object({ name: z.string(), sha256: digest }).strict()), entriesSha256: digest }).strict().parse(json(file));
  if (!same(head.entries, entries) || head.entriesSha256 !== hashObject(entries)) refuse("durable ledger head changed");
  return hash(read(file));
}
function publishLedgerHead(previous: string | null, flush: (directory: string) => void) {
  const directory = continuationDirectory(), file = path.join(directory, "ledger-head.json");
  if (previous === null ? exists(file) : !exists(file) || hash(read(file)) !== previous) refuse("ledger head publication raced");
  const entries = rawEntries(), value = { format: "keryx-original-continuation-ledger-head-v1", entries, entriesSha256: hashObject(entries) };
  const bytes = Buffer.from(`${canonicalJson(value)}\n`), temporary = path.join(directory, "ledger-head-next.json");
  const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (previous === null ? exists(file) : hash(read(file)) !== previous) refuse("ledger head publication raced");
  fs.renameSync(temporary, file); flush(directory);
  if (!read(file).equals(bytes)) refuse("ledger head acknowledgement uncertain");
}
function retain(name: string, value: unknown, flush = syncDirectory) {
  const directory = continuationDirectory(); protectedPath(directory, true);
  const previousHead = assertLedgerHead();
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  const file = path.join(directory, name), fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  flush(directory);
  if (!read(file).equals(bytes)) refuse("durable publication acknowledgement uncertain");
  if (!nonLedgerNames.has(name)) publishLedgerHead(previousHead, flush);
}
const retainedSchema = z.object({ format: z.literal("keryx-original-continuation-retained-authorization-v1"),
  authorizationFile: z.string().min(1), authorizationSha256: digest }).strict();
const attemptSchema = z.object({ format: z.literal("keryx-original-continuation-attempt-v1"),
  authorizationSha256: digest, claimId: digest, attempt: z.number().int().min(1).max(8),
  attemptId: digest, startedAt: timestamp }).strict();
const attemptOutcomeSchema = z.object({ format: z.literal("keryx-original-continuation-attempt-outcome-v1"),
  attemptId: digest, endedAt: timestamp, outcome: z.enum(["review-completed", "failed", "revoked"]) }).strict();
const holdSchema = z.object({ format: z.literal("keryx-original-continuation-model-hold-v1"),
  authorizationSha256: digest, claimId: digest, attemptId: digest,
  slot: z.number().int().min(1).max(8), stage: stageSchema, promptSha256: digest,
  packetSha256: digest, inputSemanticSha256: digest, executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  reservedAt: timestamp, reserveMicroUsd: z.literal(LIMITS.modelReserveMicroUsd),
  inputBytes: z.number().int().min(1).max(LIMITS.maximumInputBytes),
  maximumOutputTokens: z.number().int().min(1).max(LIMITS.maximumOutputTokens),
  outcome: z.literal("held-regardless-of-provider-outcome") }).strict();
const checkpointSchema = z.object({ format: z.literal("keryx-original-continuation-checkpoint-v1"),
  holdSha256: digest, resultSha256: digest, completedAt: timestamp, result: z.record(z.string(), z.unknown()) }).strict();
const callOutcomeSchema = z.object({ format: z.literal("keryx-original-continuation-model-outcome-v1"),
  holdSha256: digest, checkpointSha256: digest.nullable(), completedAt: timestamp,
  outcome: z.enum(["normalized-json-checkpoint", "failed-no-reusable-output"]) }).strict();
const preparedSchema = z.object({ format: z.literal("keryx-original-continuation-prepared-result-v1"),
  authorizationSha256: digest, nativeClaimSha256: digest, claimId: digest, originalId: z.string(),
  runSha256: digest, providerLedgerSha256: digest, completedAt: timestamp, run: z.unknown() }).strict();
const deliverySchema = z.object({ format: z.literal("keryx-original-continuation-delivered-v1"),
  authorizationSha256: digest, originalAuthorizationSha256: digest, nativeClaimSha256: digest,
  policySha256: digest, failedClosureSha256: digest, originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  originalFulfillmentProviderLedgerSha256: digest, claimId: digest, runSha256: digest, providerLedgerSha256: digest,
  preparedResultSha256: digest, completedAt: timestamp, outcome: z.literal("verified-fulfilled-original"),
  admissionPaused: z.literal(false), paidDeliveryObligation: z.literal("resolved"), deliveryCompleted: z.literal(true),
  refunded: z.literal(false), noNewInboundPayment: z.literal(true) }).strict();
export function readContinuationAuthorization(file: string, expectedSha256: string, supplier = false) {
  digest.parse(expectedSha256); const bytes = read(file, 65_536);
  if (hash(bytes) !== expectedSha256) refuse("authorization changed");
  const authorization = continuationAuthorizationSchema.parse(JSON.parse(bytes.toString("utf8")));
  const original = readRetainedFulfillmentBinding(), local = readRetainedFulfillmentClaim(original);
  const oldLedger = fulfillmentProviderLedger(original);
  if (authorization.originalAuthorizationSha256 !== original.authorizationSha256 ||
    authorization.originalClaimSha256 !== hash(read(path.join(fulfillmentDirectory(), "claim.json"))) ||
    authorization.originalFulfillmentProviderLedgerSha256 !== oldLedger.sha256 || oldLedger.newModelCalls !== 2 ||
    oldLedger.combinedReservedMicroUsd !== authorization.historicalReservedMicroUsd ||
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
  if (supplier && (Date.now() >= Date.parse(authorization.expiresAt) ||
    fulfillmentExecutorCommit() !== authorization.executorCommit)) refuse("supplier authority expired or source changed");
  return { authorization, authorizationFile: file, authorizationSha256: expectedSha256, original, local };
}
export type ContinuationBinding = ReturnType<typeof readContinuationAuthorization>;
function retainedBinding() {
  protectedPath(continuationDirectory(), true);
  const retained = retainedSchema.parse(json(path.join(continuationDirectory(), "authorization.json")));
  return readContinuationAuthorization(retained.authorizationFile, retained.authorizationSha256);
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
  const directory = continuationDirectory(); protectedPath(directory, true);
  assertLedgerHead();
  const names = fs.readdirSync(directory).sort(), entries: Array<{ name: string; sha256: string }> = [];
  const attempts = new Map<string, z.infer<typeof attemptSchema>>();
  const holds: Array<{ hold: z.infer<typeof holdSchema>; sha256: string; checkpoint?: z.infer<typeof checkpointSchema> }> = [];
  const parsed = new Map<string, unknown>();
  for (const name of names) {
    if (nonLedgerNames.has(name)) { protectedPath(path.join(directory, name), false); continue; }
    const bytes = read(path.join(directory, name)); parsed.set(name, JSON.parse(bytes.toString("utf8")));
    entries.push({ name, sha256: hash(bytes) });
    if (name === "authorization.json") {
      if (!same(parsed.get(name), { format: "keryx-original-continuation-retained-authorization-v1",
        authorizationFile: binding.authorizationFile, authorizationSha256: binding.authorizationSha256 })) refuse("retained grant changed");
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
  for (const [name, value] of parsed) {
    if (/^call-[0-9]{2}\.json$/.test(name)) {
      const hold = holdSchema.parse(value), attempt = attempts.get(hold.attemptId);
      if (!attempt || hold.slot !== holds.length + 1 || name !== `call-${numberName(hold.slot)}.json` ||
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
      const record = z.object({ format: z.literal("keryx-original-continuation-diagnostic-v1"), attemptId: digest,
        recordedAt: timestamp, diagnostic: diagnosticSchema }).strict().parse(value);
      if (!attempts.has(record.attemptId) || Date.parse(record.recordedAt) > Date.now()) refuse("diagnostic binding refused");
    }
  }
  if (holds.length > binding.authorization.maximumNewModelCalls || attempts.size > 8 ||
    binding.authorization.historicalReservedMicroUsd + holds.length * LIMITS.modelReserveMicroUsd > binding.authorization.maximumCombinedMicroUsd ||
    !same(names, fs.readdirSync(directory).sort())) refuse("ledger changed or exceeded bounds");
  return { sha256: hashObject(entries), newModelCalls: holds.length, oldAdditiveModelCalls: 2,
    reservedMicroUsd: holds.length * LIMITS.modelReserveMicroUsd,
    combinedReservedMicroUsd: binding.authorization.historicalReservedMicroUsd + holds.length * LIMITS.modelReserveMicroUsd,
    holds, attempts: [...attempts.values()] };
}

declare const capabilityBrand: unique symbol;
export interface ContinuationCapability { readonly [capabilityBrand]: true }
type NativeDb = FailedBusinessCanaryProofDb & Pick<KeryxDB,
  "getA2aFailedOriginalFulfillment" | "completeA2aFailedOriginalFulfillment" | "hasA2aFailedOriginalFulfillment">;
interface State { binding: ContinuationBinding; claim: A2aFulfillmentClaim; open: boolean; busy: boolean;
  attempt: z.infer<typeof attemptSchema>; nextStage: number; revocation: AbortController;
  flush: (directory: string) => void; lockSha256: string; uncertain: boolean; releaseRequested: boolean }
const capabilities = new WeakMap<ContinuationCapability, State>();
const dispatch = new AsyncLocalStorage<{ capability: ContinuationCapability; slot: number; holdSha256: string }>();
function nativeClaimMatches(binding: ContinuationBinding, claim: A2aFulfillmentClaim) {
  return hashObject(claim) === binding.authorization.nativeClaimSha256 && claim.claimId === binding.local.claimId &&
    same(claim.authority, binding.original.authority) && claim.claimedAt === binding.local.claimedAt;
}
/** Private observation/preflight. It neither creates a lock nor changes native state. */
export async function inspectOriginalContinuation(db: NativeDb, file: string, expectedSha256: string) {
  const binding = readContinuationAuthorization(file, expectedSha256);
  const record = await db.getA2aFailedOriginalFulfillment?.(binding.original.authority.original.id);
  if (!record || !nativeClaimMatches(binding, record.claim)) refuse("fresh native retained claim changed");
  if (record.completion === null) {
    const failure = await verifyFailedBusinessCanary(db);
    if (failure.originalEvidenceSha256 !== binding.authorization.originalEvidenceSha256) refuse("fresh native failure changed");
  } else if (await db.hasA2aFailedOriginalFulfillment?.(binding.original.authority) !== true) refuse("native completion proof unavailable");
  const directory = continuationDirectory(); let ledger = null;
  if (exists(directory)) {
    protectedPath(directory, true);
    if (fs.readdirSync(directory).length) ledger = continuationProviderLedger(binding);
  }
  const sourceBound = fulfillmentExecutorCommit() === binding.authorization.executorCommit;
  return { binding, claim: record.claim, newModelCalls: ledger?.newModelCalls ?? 0,
    combinedReservedMicroUsd: ledger?.combinedReservedMicroUsd ?? binding.authorization.historicalReservedMicroUsd,
    supplierWindowLive: sourceBound && Date.now() < Date.parse(binding.authorization.expiresAt),
    executionIntentRetained: exists(path.join(directory, "execution-lock.json")),
    prepared: exists(path.join(directory, "prepared-result.json")),
    deliveredMarker: exists(path.join(directory, "delivered.json")), nativeCompleted: record.completion !== null,
    providerRequests: 0, payments: 0 };
}
/** A new additive attempt uses the existing permanent native claim; it never reclaims or requeues it. */
export async function beginOriginalContinuation(db: NativeDb, file: string, expectedSha256: string, flush = syncDirectory) {
  const binding = readContinuationAuthorization(file, expectedSha256, true);
  const failure = await verifyFailedBusinessCanary(db), record = await db.getA2aFailedOriginalFulfillment?.(binding.original.authority.original.id);
  if (!record || record.completion !== null || !nativeClaimMatches(binding, record.claim) ||
    failure.originalEvidenceSha256 !== binding.authorization.originalEvidenceSha256) refuse("fresh native retained claim changed");
  const directory = continuationDirectory(); protectedPath(directory, true);
  if (exists(path.join(directory, "prepared-result.json")) || exists(path.join(directory, "delivered.json"))) refuse("execution already prepared");
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
    const attempt = attemptSchema.parse({ format: "keryx-original-continuation-attempt-v1", authorizationSha256: expectedSha256,
      claimId: record.claim.claimId, attempt: ledger.attempts.length + 1, attemptId: lock.attemptId, startedAt: lock.startedAt });
    retain(`attempt-${numberName(attempt.attempt)}.json`, attempt, flush);
    readContinuationAuthorization(file, expectedSha256, true); continuationProviderLedger(binding);
    const capability = Object.freeze({}) as ContinuationCapability;
    capabilities.set(capability, { binding: structuredClone(binding), claim: structuredClone(record.claim), open: true, busy: false, attempt, nextStage: 0,
      revocation: new AbortController(), flush, lockSha256, uncertain: false, releaseRequested: false });
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
/** Exact successful normalized checkpoints are reusable; failed/unknown holds stay consumed. */
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
  const reusable = [...ledger.holds].reverse().find(item => item.hold.stage === stage && item.hold.promptSha256 === promptSha256 &&
    item.checkpoint && exists(path.join(continuationDirectory(), `call-${numberName(item.hold.slot)}-outcome.json`)));
  if (reusable?.checkpoint) {
    state.nextStage++;
    if (stage === "review") endAttempt(state, "review-completed");
    return structuredClone(reusable.checkpoint.result);
  }
  if (ledger.newModelCalls >= state.binding.authorization.maximumNewModelCalls) refuse("supplier allowance exhausted");
  const slot = ledger.newModelCalls + 1, stem = `call-${numberName(slot)}`;
  const hold = holdSchema.parse({ format: "keryx-original-continuation-model-hold-v1", authorizationSha256: state.binding.authorizationSha256,
    claimId: state.claim.claimId, attemptId: state.attempt.attemptId, slot, stage, promptSha256,
    packetSha256: state.binding.authorization.packetSha256, inputSemanticSha256: state.binding.authorization.inputSemanticSha256,
    executorCommit: state.binding.authorization.executorCommit, reservedAt: now(), reserveMicroUsd: LIMITS.modelReserveMicroUsd,
    inputBytes, maximumOutputTokens, outcome: "held-regardless-of-provider-outcome" });
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
  const statements = run.originalFulfillment?.statements;
  if (!statements?.length || !binding.original.authorization.requiredSupportedTargetIndexes.every(index =>
    statements.some(statement => statement.claimIndex === index) && (run.claimCoverage?.[index]?.coverage ?? 0) >= 0.4) ||
    !run.evidence?.filter(item => item.qualifiesForAnswer).every(item => statements.some(statement => statement.claimIndex === item.claimIndex)))
    refuse("prepared result lacks reviewed required support");
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
  validateFulfilledQueryRun(run, state.claim, completion); assertPreparedQuality(state.binding, run);
  state.uncertain = true;
  retain("prepared-result.json", { format: "keryx-original-continuation-prepared-result-v1",
    authorizationSha256: state.binding.authorizationSha256, nativeClaimSha256: state.binding.authorization.nativeClaimSha256, ...completion }, state.flush);
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
    raw.providerLedgerSha256 !== ledger.sha256 || !ledger.holds.some(item => item.hold.stage === "review" && item.checkpoint)) refuse("prepared ledger changed");
  validateFulfilledQueryRun(completion.run, record.claim, completion); assertPreparedQuality(binding, completion.run);
  return { binding, claim: record.claim, completion, preparedResultSha256: hash(bytes) };
}
/** Complete only the same permanent claim, with exact digest review and fresh native proof. */
export async function completePreparedContinuation(db: NativeDb, expectedPreparedSha256: string, flush = syncDirectory) {
  const before = await verifyPreparedContinuation(db);
  if (!digest.safeParse(expectedPreparedSha256).success || before.preparedResultSha256 !== expectedPreparedSha256) refuse("reviewed prepared-result digest changed");
  if (await db.completeA2aFailedOriginalFulfillment?.(before.completion) !== true ||
    await db.hasA2aFailedOriginalFulfillment?.(before.binding.original.authority) !== true) refuse("native delivery acknowledgement uncertain");
  const after = await verifyPreparedContinuation(db);
  if (!same(before, after) || await db.hasA2aFailedOriginalFulfillment?.(before.binding.original.authority) !== true) refuse("fresh native delivery proof changed");
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
  if (!same(json(file), marker) || await db.hasA2aFailedOriginalFulfillment?.(before.binding.original.authority) !== true) refuse("delivery marker acknowledgement uncertain");
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
