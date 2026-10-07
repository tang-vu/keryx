import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { businessCanaryHostIdentity, retainedFailedBusinessCanaryAuthority, verifyFailedBusinessCanary,
  type RetainedFailedCanaryAuthority, type FailedBusinessCanaryProofDb } from "./canary-policy";
import { ORIGINAL_FULFILLMENT_LIMITS as LIMITS, fulfillmentInputSchema, fulfillmentAuthoritySchema,
  fulfillmentObjectSha256 as hashObject, fulfillmentSha256 as hash, validateFulfilledQueryRun,
  type FulfillmentAuthority, type A2aFulfillmentClaim, type A2aFulfillmentCompletion } from "../a2a/failed-original-fulfillment-protocol";
import type { KeryxDB } from "../db/keryx-db";
import type { GatheredContent } from "../llm/reasoning-engine";
import type { QueryRun } from "../types";
import { fulfillmentSupplierWindowSchema, fulfillmentTimestampSchema, matchesFulfillmentSupplierWindow } from "../a2a/fulfillment-window";
import { retainedContinuationDeliveryResolution } from "./fulfillment-continuation-policy";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
function refuse(reason: string): never { throw new Error(`Original fulfillment ${reason}; preserve all claims and reservations`); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const fulfillmentAuthorizationV1Schema = z.object({
  format: z.literal("keryx-canary-original-fulfillment-authorization-v1"),
  approvalId: z.literal("operator-business-20261006"), approvedAt: timestamp,
  executionHostSha256: digest, executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  policySha256: digest, failedClosureSha256: digest, originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  inputFile: z.string().min(1), inputSha256: digest, inputSemanticSha256: digest,
  sourceManifestFile: z.string().min(1), sourceManifestSha256: digest, packetSha256: digest,
  requiredSupportedTargetIndexes: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  tariffFile: z.string().min(1), tariffBodySha256: digest,
  tariffUrl: z.literal("https://api-docs.deepseek.com/quick_start/pricing/"), tariffRetrievedAt: timestamp,
  tariffInputUsdPerMillion: z.literal(0.30), tariffOutputUsdPerMillion: z.literal(1.20),
  provider: z.literal("deepseek"), endpoint: z.literal("https://api.deepseek.com/chat/completions"),
  model: z.literal("deepseek-v4-flash"), expiresAt: z.literal(LIMITS.expiresAt),
  maximumNewModelCalls: z.literal(3),
  reserveMicroUsd: z.literal(LIMITS.modelReserveMicroUsd), originalReservedMicroUsd: z.literal(LIMITS.originalReservedMicroUsd),
  creatorPayments: z.literal("forbidden"), searches: z.literal("forbidden"),
}).strict();
const fulfillmentAuthorizationV2Schema = fulfillmentAuthorizationV1Schema.extend({
  format: z.literal("keryx-canary-original-fulfillment-authorization-v2"),
  expiresAt: fulfillmentTimestampSchema,
  supplierWindow: fulfillmentSupplierWindowSchema,
});
export const fulfillmentAuthorizationSchema = z.discriminatedUnion("format", [fulfillmentAuthorizationV1Schema, fulfillmentAuthorizationV2Schema])
  .refine(value => value.format === "keryx-canary-original-fulfillment-authorization-v1" ||
    matchesFulfillmentSupplierWindow(value), "Supplier approval or expiry outside explicit window");
export type FulfillmentAuthorization = z.infer<typeof fulfillmentAuthorizationSchema>;
const documentSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/), requestedUrl: z.string().url(),
  finalUrl: z.string().url(), title: z.string().min(1).max(1000), retrievedAt: timestamp,
  extraction: z.enum(["html", "text", "pdf"]), truncated: z.literal(false),
  bodyFile: z.string().regex(/^[a-z0-9-]+\.txt$/), bodySha256: digest, bodyBytes: z.number().int().positive().max(200000),
}).strict();
const manifestSchema = z.object({ format: z.literal("keryx-frozen-official-canary-documents-v1"),
  reader: z.literal("lib/web-research/article-reader.ts"), documents: z.array(documentSchema).min(1).max(16),
}).strict();
export function fulfillmentDirectory() { return path.join(os.homedir(), ".local", "share", "keryx-business-canary-fulfillment"); }
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
      const stat = fs.lstatSync(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o022) !== 0 ||
        stat.uid !== 0 && stat.uid !== process.getuid!()) refuse("writable or foreign ancestor refused");
      if (parent === path.dirname(parent)) break;
    }
  }
  return stat;
}
function read(file: string, maximumBytes = 65536) {
  protectedPath(file, false);
  const before = fs.lstatSync(file, { bigint: true });
  if (before.size > BigInt(maximumBytes)) refuse("file byte limit exceeded");
  const signature = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.size,
    stat.mtimeNs, stat.ctimeNs, stat.uid, stat.gid, stat.mode, stat.nlink].join(":");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (signature(opened) !== signature(before)) refuse("file changed during read");
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true });
    protectedPath(file, false);
    if (BigInt(bytes.length) !== before.size || signature(after) !== signature(before) ||
      signature(fs.lstatSync(file, { bigint: true })) !== signature(before)) refuse("file changed during read");
    return bytes;
  } finally { fs.closeSync(fd); }
}
function json(file: string, maximumBytes?: number): unknown { return JSON.parse(read(file, maximumBytes).toString("utf8")); }
function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function retain(name: string, value: unknown, flush = syncDirectory) {
  const directory = fulfillmentDirectory(); protectedPath(directory, true);
  const fd = fs.openSync(path.join(directory, name), "wx", 0o600);
  try { fs.writeFileSync(fd, `${canonicalJson(value)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  flush(directory);
}
/** Actual checkout identity for the private CLI. No remote operation or environment alias. */
export function fulfillmentExecutorCommit() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit) || execFileSync("git", ["status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8", windowsHide: true }).trim()) refuse("executor source is not a clean reviewed commit");
  return commit;
}
/** Private whole-body input. Unselected references are retained on disk, never gathered. */
export function readFrozenFulfillmentPacket(inputFile: string, inputSha256: string, manifestFile: string, manifestSha256: string) {
  const inputBytes = read(inputFile), manifestBytes = read(manifestFile);
  if (hash(inputBytes) !== inputSha256 || hash(manifestBytes) !== manifestSha256) refuse("frozen input digest changed");
  const input = fulfillmentInputSchema.parse(JSON.parse(inputBytes.toString("utf8")));
  const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (input.sourceManifestSha256 !== manifestSha256 || new Set(manifest.documents.map(item => item.id)).size !== manifest.documents.length)
    refuse("frozen manifest binding refused");
  const gathered: GatheredContent[] = input.selectedDocumentIds.map((id, index) => {
    const document = manifest.documents.find(item => item.id === id); if (!document) return refuse("selected document missing");
    for (const value of [document.requestedUrl, document.finalUrl]) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search ||
        !["developers.circle.com", "docs.arc.io"].includes(url.hostname)) refuse("official public reference refused");
    }
    if (Date.parse(document.retrievedAt) > Date.now()) refuse("document chronology refused");
    const bytes = read(path.join(path.dirname(manifestFile), document.bodyFile), 200000), text = bytes.toString("utf8");
    if (bytes.length !== document.bodyBytes || hash(bytes) !== document.bodySha256 || !Buffer.from(text, "utf8").equals(bytes))
      refuse("document body changed");
    return { sourceId: `public:fulfillment:${id}`, sourceName: document.title, marker: `S${index + 1}`, text,
      sourceKind: "public-reference", creatorRewardEligible: false, itemId: id, itemTitle: document.title,
      itemUrl: document.finalUrl, contentVersion: document.bodySha256,
      requestedSource: { urls: [document.requestedUrl], readScope: "bounded-whole-document" },
      webProvenance: { retrievedAt: document.retrievedAt, publisherGroup: new URL(document.finalUrl).hostname,
        normalizedBodyHash: document.bodySha256, extraction: document.extraction, truncated: false } };
  });
  return { input, gathered, packetSha256: hashObject({ input, gathered }), inputSemanticSha256: hashObject(input) };
}
interface ReviewedBinding {
  authorization: FulfillmentAuthorization; authorizationFile: string; authorizationSha256: string;
  authority: FulfillmentAuthority; packet: ReturnType<typeof readFrozenFulfillmentPacket>;
}
function matchOld(authorization: FulfillmentAuthorization, old: RetainedFailedCanaryAuthority) {
  if (authorization.policySha256 !== old.policySha256 || authorization.failedClosureSha256 !== old.failedClosureSha256 ||
    authorization.originalEvidenceSha256 !== old.originalEvidenceSha256 || authorization.originalProviderLedgerSha256 !== old.originalProviderLedgerSha256 ||
    old.providerLedger.modelCalls !== 1 || old.providerLedger.searchCalls !== 2 || old.providerLedger.reservedMicroUsd !== LIMITS.originalReservedMicroUsd)
    refuse("historical failure or provider holds changed");
}
export function readFulfillmentAuthorization(file: string, expectedSha256: string, supplier = false): ReviewedBinding {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) refuse("authorization digest refused");
  const bytes = read(file); if (hash(bytes) !== expectedSha256) refuse("authorization changed");
  const authorization = fulfillmentAuthorizationSchema.parse(JSON.parse(bytes.toString("utf8")));
  const old = retainedFailedBusinessCanaryAuthority(); matchOld(authorization, old);
  if (authorization.executionHostSha256 !== businessCanaryHostIdentity() ||
    Date.parse(authorization.approvedAt) < Date.parse("2026-10-06T03:23:02.644Z") || Date.parse(authorization.approvedAt) > Date.now() ||
    authorization.tariffRetrievedAt.slice(0, 10) !== "2026-10-06" || Date.parse(authorization.tariffRetrievedAt) > Date.parse(authorization.approvedAt) ||
    hash(read(authorization.tariffFile, 200000)) !== authorization.tariffBodySha256) refuse("authorization host or tariff refused");
  const packet = readFrozenFulfillmentPacket(authorization.inputFile, authorization.inputSha256,
    authorization.sourceManifestFile, authorization.sourceManifestSha256);
  if (packet.packetSha256 !== authorization.packetSha256 || packet.inputSemanticSha256 !== authorization.inputSemanticSha256 ||
    hash(old.question) !== packet.input.questionSha256 || new Set(authorization.requiredSupportedTargetIndexes).size !== authorization.requiredSupportedTargetIndexes.length ||
    authorization.requiredSupportedTargetIndexes.some(index => index >= packet.input.targets.length)) refuse("reviewed packet changed");
  if (supplier && (Date.now() >= Date.parse(authorization.expiresAt) || Date.now() < Date.parse(authorization.approvedAt) ||
    fulfillmentExecutorCommit() !== authorization.executorCommit)) refuse("supplier authority expired or source changed");
  const authority = fulfillmentAuthoritySchema.parse({ format: authorization.format === "keryx-canary-original-fulfillment-authorization-v2"
    ? "keryx-a2a-failed-original-fulfillment-authority-v2" : "keryx-a2a-failed-original-fulfillment-authority-v1",
    original: old.original, question: old.question, input: packet.input, authorizationSha256: expectedSha256,
    policySha256: old.policySha256, failedClosureSha256: old.failedClosureSha256,
    originalEvidenceSha256: old.originalEvidenceSha256, originalProviderLedgerSha256: old.originalProviderLedgerSha256,
    executorCommit: authorization.executorCommit, expiresAt: authorization.expiresAt,
    ...(authorization.format === "keryx-canary-original-fulfillment-authorization-v2" ? { supplierWindow: authorization.supplierWindow } : {}) });
  return { authorization, authorizationFile: file, authorizationSha256: expectedSha256, authority, packet };
}
const retainedAuthorizationSchema = z.object({ format: z.literal("keryx-original-fulfillment-retained-authorization-v1"),
  authorizationFile: z.string().min(1), authorizationSha256: digest }).strict();
const localClaimSchema = z.object({ format: z.literal("keryx-original-fulfillment-claim-v1"), authority: fulfillmentAuthoritySchema,
  claimId: digest, claimedAt: timestamp }).strict();
const modelHoldSchema = z.object({ format: z.literal("keryx-original-fulfillment-model-hold-v1"), authorizationSha256: digest,
  claimId: digest, slot: z.number().int().min(2).max(11), stage: z.enum(["sufficiency", "synthesize", "review"]),
  reservedAt: timestamp, reserveMicroUsd: z.literal(LIMITS.modelReserveMicroUsd),
  inputBytes: z.number().int().min(1).max(LIMITS.maximumInputBytes), maximumOutputTokens: z.number().int().min(1).max(LIMITS.maximumOutputTokens),
  outcome: z.literal("held-regardless-of-provider-outcome") }).strict();
const preparedSchema = z.object({ format: z.literal("keryx-original-fulfillment-prepared-result-v1"), claimId: digest,
  originalId: z.string(), runSha256: digest, providerLedgerSha256: digest, completedAt: timestamp, run: z.unknown() }).strict();
const deliverySchema = z.object({ format: z.literal("keryx-original-fulfillment-delivered-v1"), authorizationSha256: digest,
  policySha256: digest, failedClosureSha256: digest, originalEvidenceSha256: digest, originalProviderLedgerSha256: digest,
  claimId: digest, runSha256: digest, providerLedgerSha256: digest, preparedResultSha256: digest, completedAt: timestamp,
  outcome: z.literal("verified-fulfilled-original"), admissionPaused: z.literal(false), paidDeliveryObligation: z.literal("resolved"),
  deliveryCompleted: z.literal(true), refunded: z.literal(false), noNewInboundPayment: z.literal(true) }).strict();
function retainedBinding() {
  const directory = fulfillmentDirectory(); protectedPath(directory, true);
  const retained = retainedAuthorizationSchema.parse(json(path.join(directory, "authorization.json")));
  return readFulfillmentAuthorization(retained.authorizationFile, retained.authorizationSha256);
}
function localClaim(binding: ReviewedBinding) {
  const claim = localClaimSchema.parse(json(path.join(fulfillmentDirectory(), "claim.json")));
  if (!same(claim.authority, binding.authority) || Date.parse(claim.claimedAt) < Date.parse(binding.authorization.approvedAt) ||
    Date.parse(claim.claimedAt) >= Date.parse(binding.authorization.expiresAt) || Date.parse(claim.claimedAt) > Date.now()) refuse("local claim changed");
  return claim;
}
/** Readonly original bindings for a separately authorized additive continuation.
 * These helpers neither renew supplier permission nor recreate the native claim. */
export function readRetainedFulfillmentBinding() { return retainedBinding(); }
export function readRetainedFulfillmentClaim(binding: ReturnType<typeof readFulfillmentAuthorization>) { return localClaim(binding); }
/** Inspection only: the unique failed execution remains consumed. An expired,
 * unprepared claim can be isolated from unrelated interactive research; this
 * never creates or restores an execution capability. */
export function inspectExpiredUnpreparedFulfillment() {
  const binding = retainedBinding(), local = localClaim(binding);
  if (Date.now() < Date.parse(binding.authorization.expiresAt) ||
    exists(path.join(fulfillmentDirectory(), "prepared-result.json")) ||
    exists(path.join(fulfillmentDirectory(), "delivered.json"))) refuse("claim is not expired and unprepared");
  const providerLedger = fulfillmentProviderLedger(binding);
  if (providerLedger.newModelCalls >= 3) refuse("completed supplier calls require prepared-result recovery");
  return { claim: { authority: local.authority, claimId: local.claimId, claimedAt: local.claimedAt },
    authorizationSha256: binding.authorizationSha256, expiresAt: binding.authorization.expiresAt, providerLedger };
}
/** Commit raw bytes of every additive authorization, claim and model hold. Results/markers
 * commit this digest, while old ledger/closure bytes remain separately bound and unchanged. */
export function fulfillmentProviderLedger(binding = retainedBinding()) {
  const directory = fulfillmentDirectory(); protectedPath(directory, true); const claim = localClaim(binding);
  const names = fs.readdirSync(directory).sort(), entries: Array<{ name: string; sha256: string }> = [];
  const stages = ["sufficiency", "synthesize", "review"]; let calls = 0;
  for (const name of names) {
    if (["prepared-result.json", "delivered.json"].includes(name)) { protectedPath(path.join(directory, name), false); continue; }
    const bytes = read(path.join(directory, name));
    if (name === "authorization.json") {
      if (!same(JSON.parse(bytes.toString("utf8")), { format: "keryx-original-fulfillment-retained-authorization-v1",
        authorizationFile: binding.authorizationFile, authorizationSha256: binding.authorizationSha256 })) refuse("retained authorization changed");
    } else if (name === "claim.json") {
      if (!same(JSON.parse(bytes.toString("utf8")), claim)) refuse("retained claim changed");
    } else {
      const match = /^model-([0-9]{2})\.json$/.exec(name), hold = modelHoldSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (!match || hold.slot !== Number(match[1]) || hold.slot !== calls + 2 || hold.stage !== stages[calls] ||
        hold.authorizationSha256 !== binding.authorizationSha256 || hold.claimId !== claim.claimId ||
        Date.parse(hold.reservedAt) < Date.parse(claim.claimedAt) || Date.parse(hold.reservedAt) >= Date.parse(binding.authorization.expiresAt) ||
        Date.parse(hold.reservedAt) > Date.now()) refuse("model hold binding refused");
      calls++;
    }
    entries.push({ name, sha256: hash(bytes) });
  }
  if (!names.includes("authorization.json") || !names.includes("claim.json") || calls > binding.authorization.maximumNewModelCalls ||
    calls > 3 || LIMITS.originalReservedMicroUsd + calls * LIMITS.modelReserveMicroUsd > LIMITS.maximumCombinedMicroUsd ||
    !same(names, fs.readdirSync(directory).sort())) refuse("provider ledger changed or exceeded bounds");
  return { sha256: hashObject(entries), newModelCalls: calls,
    reservedMicroUsd: calls * LIMITS.modelReserveMicroUsd, combinedReservedMicroUsd: LIMITS.originalReservedMicroUsd + calls * LIMITS.modelReserveMicroUsd };
}
declare const capabilityBrand: unique symbol;
export interface FulfillmentCapability { readonly [capabilityBrand]: true }
type NativeDb = FailedBusinessCanaryProofDb & Pick<KeryxDB, "claimA2aFailedOriginalFulfillment" | "getA2aFailedOriginalFulfillment" |
  "completeA2aFailedOriginalFulfillment" | "hasA2aFailedOriginalFulfillment">;
interface CapabilityState { binding: ReviewedBinding; claim: A2aFulfillmentClaim; open: boolean; nextStep: number; calls: number;
  revocation: AbortController; flush: (directory: string) => void }
const capabilities = new WeakMap<FulfillmentCapability, CapabilityState>();
const execution = new AsyncLocalStorage<{ capability: FulfillmentCapability; step: "sufficiency" | "synthesize" }>();
/** Exclusive local intent and UNIQUE native original claim both precede provider permission.
 * An interrupted intent/claim is never retried or taken over. */
export async function beginFailedOriginalFulfillment(db: NativeDb, binding: ReviewedBinding, flush = syncDirectory) {
  const current = readFulfillmentAuthorization(binding.authorizationFile, binding.authorizationSha256, true);
  if (!same(current.authority, binding.authority) || !db.claimA2aFailedOriginalFulfillment || !db.getA2aFailedOriginalFulfillment ||
    !db.completeA2aFailedOriginalFulfillment || !db.hasA2aFailedOriginalFulfillment) refuse("native capability unavailable");
  const failed = await verifyFailedBusinessCanary(db);
  if (failed.originalEvidenceSha256 !== current.authority.originalEvidenceSha256 ||
    failed.providerLedger.sha256 !== current.authority.originalProviderLedgerSha256) refuse("fresh native failure changed");
  const directory = fulfillmentDirectory(); protectedPath(directory, true);
  if (fs.readdirSync(directory).length) refuse("execution intent already retained");
  retain("authorization.json", { format: "keryx-original-fulfillment-retained-authorization-v1",
    authorizationFile: current.authorizationFile, authorizationSha256: current.authorizationSha256 }, flush);
  const input = { authority: current.authority, claimId: randomBytes(32).toString("hex"), claimedAt: new Date().toISOString() };
  retain("claim.json", { format: "keryx-original-fulfillment-claim-v1", ...input }, flush);
  const claim = await db.claimA2aFailedOriginalFulfillment(input);
  const retained = await db.getA2aFailedOriginalFulfillment(current.authority.original.id);
  if (!claim || !retained || retained.completion !== null || !same(retained.claim, claim) ||
    !same({ authority: claim.authority, claimId: claim.claimId, claimedAt: claim.claimedAt }, input)) refuse("native claim refused or acknowledgement uncertain");
  readFulfillmentAuthorization(current.authorizationFile, current.authorizationSha256, true);
  const capability = Object.freeze({}) as FulfillmentCapability;
  capabilities.set(capability, { binding: current, claim, open: true, nextStep: 0, calls: 0, revocation: new AbortController(), flush });
  return { capability, claim, binding: current };
}
export async function fulfillmentStep<T>(capability: FulfillmentCapability, step: "sufficiency" | "synthesize", action: () => Promise<T>) {
  const state = capabilities.get(capability);
  if (!state?.open || step !== ["sufficiency", "synthesize"][state.nextStep]) refuse("execution capability revoked or step refused");
  state.nextStep++;
  try { return await execution.run({ capability, step }, action); }
  catch (error) { closeFulfillmentCapability(capability); throw error; }
}
export function closeFulfillmentCapability(capability: FulfillmentCapability) {
  const state = capabilities.get(capability); if (state) { state.open = false; state.revocation.abort(); }
}
/** Final fixed-transport dispatch check, after durable reservation and any asynchronous work. */
export function assertFulfillmentSupplierAdmission(capability: FulfillmentCapability) {
  const state = capabilities.get(capability), context = execution.getStore();
  if (!state?.open || state.revocation.signal.aborted || context?.capability !== capability ||
    (context.step === "sufficiency" ? state.calls !== 1 : state.calls !== 2 && state.calls !== 3)) refuse("supplier capability revoked");
  const binding = readFulfillmentAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256, true);
  if (!same(binding.authority, state.claim.authority) || fulfillmentProviderLedger(binding).newModelCalls !== state.calls ||
    exists(path.join(fulfillmentDirectory(), "prepared-result.json")) || exists(path.join(fulfillmentDirectory(), "delivered.json")))
    refuse("supplier reservation changed");
}
/** A dispatched request cannot outlive the frozen supplier deadline or capability revocation. */
export function fulfillmentSupplierSignal(capability: FulfillmentCapability, timeoutMs: number): AbortSignal {
  assertFulfillmentSupplierAdmission(capability);
  const state = capabilities.get(capability)!;
  const remaining = Date.parse(state.binding.authorization.expiresAt) - Date.now();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || remaining < 1) refuse("supplier deadline exhausted");
  return AbortSignal.any([state.revocation.signal, AbortSignal.timeout(Math.min(timeoutMs, remaining))]);
}
/** Only the fixed transport within a live one-shot step can reserve. No ordinary supplier
 * admission, caller-created token, expired authority, retry or extra review is accepted. */
export function reserveFulfillmentModel(capability: FulfillmentCapability, system: string, user: string, maximumOutputTokens: number) {
  const state = capabilities.get(capability), context = execution.getStore();
  if (!state?.open || context?.capability !== capability || state.calls >= 3 ||
    (context.step === "sufficiency" ? state.calls !== 0 : state.calls !== 1 && state.calls !== 2)) refuse("opaque model capability refused");
  const binding = readFulfillmentAuthorization(state.binding.authorizationFile, state.binding.authorizationSha256, true);
  if (!same(binding.authority, state.claim.authority)) refuse("execution authority changed");
  const inputBytes = Buffer.byteLength(system + " Respond with a single JSON object." + user, "utf8");
  if (inputBytes > LIMITS.maximumInputBytes || !Number.isInteger(maximumOutputTokens) || maximumOutputTokens < 1 || maximumOutputTokens > LIMITS.maximumOutputTokens)
    refuse("model input/output limit exceeded");
  const ledger = fulfillmentProviderLedger(binding);
  if (ledger.newModelCalls !== state.calls || exists(path.join(fulfillmentDirectory(), "prepared-result.json")) ||
    exists(path.join(fulfillmentDirectory(), "delivered.json"))) refuse("retained execution already consumed");
  const slot = state.calls + 2, stage = ["sufficiency", "synthesize", "review"][state.calls];
  try {
    retain(`model-${String(slot).padStart(2, "0")}.json`, { format: "keryx-original-fulfillment-model-hold-v1",
      authorizationSha256: binding.authorizationSha256, claimId: state.claim.claimId, slot, stage,
      reservedAt: new Date().toISOString(), reserveMicroUsd: LIMITS.modelReserveMicroUsd,
      inputBytes, maximumOutputTokens, outcome: "held-regardless-of-provider-outcome" }, state.flush);
    state.calls++;
    readFulfillmentAuthorization(binding.authorizationFile, binding.authorizationSha256, true);
    if (fulfillmentProviderLedger(binding).newModelCalls !== state.calls) refuse("model reservation readback refused");
  } catch (error) { closeFulfillmentCapability(capability); throw error; }
}
function assertPreparedQuality(binding: ReviewedBinding, run: QueryRun) {
  const statements = run.originalFulfillment?.statements;
  if (!statements?.length || !binding.authorization.requiredSupportedTargetIndexes.every(index =>
    statements.some(statement => statement.claimIndex === index) && (run.claimCoverage?.[index]?.coverage ?? 0) >= 0.4) ||
    !run.evidence?.filter(item => item.qualifiesForAnswer).every(item => statements.some(statement => statement.claimIndex === item.claimIndex)))
    refuse("prepared result lacks reviewed required support");
}
export function prepareFulfillmentResult(capability: FulfillmentCapability, run: QueryRun) {
  const state = capabilities.get(capability);
  if (!state?.open || state.nextStep !== 2 || state.calls !== 3) refuse("complete reviewed result unavailable");
  const ledger = fulfillmentProviderLedger(state.binding);
  const completion: A2aFulfillmentCompletion = { claimId: state.claim.claimId, originalId: state.claim.authority.original.id,
    runSha256: hashObject(run), providerLedgerSha256: ledger.sha256, completedAt: new Date().toISOString(), run };
  validateFulfilledQueryRun(run, state.claim, completion);
  assertPreparedQuality(state.binding, run);
  closeFulfillmentCapability(capability);
  retain("prepared-result.json", { format: "keryx-original-fulfillment-prepared-result-v1", ...completion }, state.flush);
  if (!same(json(path.join(fulfillmentDirectory(), "prepared-result.json"), 1000000), { format: "keryx-original-fulfillment-prepared-result-v1", ...completion }))
    refuse("prepared result acknowledgement uncertain");
  return completion;
}
/** Readonly native proof, usable after expiry. It never invokes a provider or completes a job. */
export async function verifyPreparedFulfillment(db: NativeDb) {
  const binding = retainedBinding(), local = localClaim(binding), ledger = fulfillmentProviderLedger(binding);
  const record = await db.getA2aFailedOriginalFulfillment?.(binding.authority.original.id);
  if (!record || record.claim.claimId !== local.claimId || !same(record.claim.authority, binding.authority)) refuse("native retained claim changed");
  const preparedBytes = read(path.join(fulfillmentDirectory(), "prepared-result.json"), 1000000);
  const raw = preparedSchema.parse(JSON.parse(preparedBytes.toString("utf8")));
  const completion: A2aFulfillmentCompletion = { claimId: raw.claimId, originalId: raw.originalId, runSha256: raw.runSha256,
    providerLedgerSha256: raw.providerLedgerSha256, completedAt: raw.completedAt, run: raw.run as QueryRun };
  if (ledger.newModelCalls !== 3 || ledger.sha256 !== completion.providerLedgerSha256) refuse("prepared provider ledger changed");
  validateFulfilledQueryRun(completion.run, record.claim, completion);
  assertPreparedQuality(binding, completion.run);
  return { binding, claim: record.claim, completion, preparedResultSha256: hash(preparedBytes) };
}
/** Idempotent prepared-result metadata completion only. Missing/partial results cannot restart
 * execution. Lost acknowledgement keeps admission held until an exact fresh native readback. */
export async function completePreparedFulfillment(db: NativeDb, expectedPreparedSha256: string, flush = syncDirectory) {
  const before = await verifyPreparedFulfillment(db);
  if (!/^[a-f0-9]{64}$/.test(expectedPreparedSha256) || before.preparedResultSha256 !== expectedPreparedSha256)
    refuse("reviewed prepared-result digest changed");
  if (!db.completeA2aFailedOriginalFulfillment || !db.hasA2aFailedOriginalFulfillment) refuse("native completion unavailable");
  if (await db.completeA2aFailedOriginalFulfillment(before.completion) !== true ||
    await db.hasA2aFailedOriginalFulfillment(before.binding.authority) !== true) refuse("native delivery acknowledgement uncertain");
  const after = await verifyPreparedFulfillment(db);
  if (!same(after, before) || await db.hasA2aFailedOriginalFulfillment(before.binding.authority) !== true) refuse("native delivery proof changed");
  const marker = deliverySchema.parse({ format: "keryx-original-fulfillment-delivered-v1",
    authorizationSha256: before.binding.authorizationSha256, policySha256: before.binding.authority.policySha256,
    failedClosureSha256: before.binding.authority.failedClosureSha256, originalEvidenceSha256: before.binding.authority.originalEvidenceSha256,
    originalProviderLedgerSha256: before.binding.authority.originalProviderLedgerSha256,
    claimId: before.claim.claimId, runSha256: before.completion.runSha256, providerLedgerSha256: before.completion.providerLedgerSha256,
    preparedResultSha256: before.preparedResultSha256, completedAt: before.completion.completedAt,
    outcome: "verified-fulfilled-original", admissionPaused: false, paidDeliveryObligation: "resolved",
    deliveryCompleted: true, refunded: false, noNewInboundPayment: true });
  const file = path.join(fulfillmentDirectory(), "delivered.json");
  if (!exists(file)) retain("delivered.json", marker, flush);
  if (!same(json(file), marker) || !(await db.hasA2aFailedOriginalFulfillment(before.binding.authority))) refuse("delivery marker readback uncertain");
  return marker;
}
/** Filesystem observation of a separately proved delivered resolution. Old failed closure and
 * both raw provider ledgers remain immutable. Native proof is required to create this marker. */
export function retainedFulfillmentDeliveryResolution(old: RetainedFailedCanaryAuthority) {
  return retainedLegacyFulfillmentDeliveryResolution(old) ?? retainedContinuationDeliveryResolution(old);
}
function retainedLegacyFulfillmentDeliveryResolution(old: RetainedFailedCanaryAuthority) {
  const directory = fulfillmentDirectory();
  if (!exists(directory)) return null;
  protectedPath(directory, true); if (!exists(path.join(directory, "delivered.json"))) return null;
  const binding = retainedBinding(); matchOld(binding.authorization, old);
  const marker = deliverySchema.parse(json(path.join(directory, "delivered.json")));
  const local = localClaim(binding), ledger = fulfillmentProviderLedger(binding);
  const preparedBytes = read(path.join(directory, "prepared-result.json"), 1000000);
  const prepared = preparedSchema.parse(JSON.parse(preparedBytes.toString("utf8")));
  if (marker.authorizationSha256 !== binding.authorizationSha256 || marker.policySha256 !== old.policySha256 ||
    marker.failedClosureSha256 !== old.failedClosureSha256 || marker.originalEvidenceSha256 !== old.originalEvidenceSha256 ||
    marker.originalProviderLedgerSha256 !== old.originalProviderLedgerSha256 || marker.claimId !== local.claimId ||
    marker.runSha256 !== prepared.runSha256 || marker.providerLedgerSha256 !== ledger.sha256 ||
    marker.providerLedgerSha256 !== prepared.providerLedgerSha256 || marker.preparedResultSha256 !== hash(preparedBytes) ||
    marker.completedAt !== prepared.completedAt || ledger.newModelCalls !== 3 || hashObject(prepared.run) !== marker.runSha256)
    refuse("delivered resolution changed");
  return { outcome: marker.outcome, admissionPaused: marker.admissionPaused, paidDeliveryObligation: marker.paidDeliveryObligation,
    deliveryCompleted: marker.deliveryCompleted, refunded: marker.refunded, noNewInboundPayment: marker.noNewInboundPayment };
}
