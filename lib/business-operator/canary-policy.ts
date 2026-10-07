import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { buyerIntentSchemaForProfile, type BuyerIntent } from "../buyer/journal";
import { a2aRequestHash } from "../a2a/order";
import { a2aResearchPackageForVersion, a2aResearchPackageFingerprint } from "../a2a/research-package";
import { matchesA2aOriginalBinding, type A2aOriginalClaim } from "../a2a/original-claim";
import type { KeryxDB } from "../db/keryx-db";
import { retainedFulfillmentDeliveryResolution } from "./fulfillment-policy";
import { retainedCanaryResearchIsolation } from "./canary-research-isolation";
import { ResearchAdmissionHeldError } from "../research/availability-contract";

/** One reviewed owner canary, not permission to renew historical allowances or fund wallets. */
export const BUSINESS_CANARY_REVIEW = Object.freeze({
  approvalId: "operator-business-20261006",
  approvedAt: "2026-10-06T03:23:02.644Z",
  authorizationExpiresAt: "2026-10-07T03:23:02.644Z",
  priceCheckedOn: "2026-10-06",
  supplierExpiresAt: "2026-10-07T00:00:00.000Z",
  modelReserveMicroUsd: 20660,
  searchReserveMicroUsd: 8000,
  maximumModelCalls: 11,
  maximumSearchCalls: 2,
  maximumMicroUsd: 250000,
  maximumMicroUsdc: 1000000,
} as const);

const policySchema = z.object({
  format: z.literal("keryx-business-canary-v1"),
  approvalId: z.literal(BUSINESS_CANARY_REVIEW.approvalId),
  approvedAt: z.literal(BUSINESS_CANARY_REVIEW.approvedAt),
  expiresAt: z.literal(BUSINESS_CANARY_REVIEW.supplierExpiresAt),
  priceCheckedOn: z.literal(BUSINESS_CANARY_REVIEW.priceCheckedOn),
  maximumOriginals: z.literal(1),
  maximumMicroUsd: z.literal(250000),
  maximumMicroUsdc: z.literal(60000),
  creatorPaymentMode: z.literal("forbidden"),
  executionHostSha256: z.string().regex(/^[a-f0-9]{64}$/),
  original: buyerIntentSchemaForProfile(ARC_MAINNET_PROFILE),
}).strict();
export type BusinessCanaryPolicy = z.infer<typeof policySchema>;
interface ConfiguredCanary { policy: BusinessCanaryPolicy; file: string; digest: string; directory: string }
const refuse = (reason: string): never => { throw new ResearchAdmissionHeldError(`Business canary ${reason}; retained originals and holds must be preserved`); };
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** A retained active registry also closes admission if selectors are removed. Single host only. */
export function businessCanaryDirectory() { return path.join(os.homedir(), ".local", "share", "keryx-business-canary"); }
export function businessCanaryHostIdentity() {
  const machine = process.platform === "linux" ? fs.readFileSync("/etc/machine-id", "utf8").trim() : os.hostname();
  return sha(canonicalJson({ machine, platform: process.platform, user: os.userInfo().username,
    uid: process.getuid?.() ?? null, home: os.homedir() }));
}
const exists = (file: string) => { try { fs.lstatSync(file); return true; } catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
  throw error;
} };
const windowSchema = z.object({ format: z.literal("keryx-business-canary-window-v1"),
  approvalId: z.literal(BUSINESS_CANARY_REVIEW.approvalId), policyFile: z.string().min(1),
  policySha256: z.string().regex(/^[a-f0-9]{64}$/), queryId: z.string().regex(/^a2a_[a-f0-9]{64}$/),
  maximumOriginals: z.literal(1), maximumMicroUsdc: z.literal(60000), maximumMicroUsd: z.literal(250000) }).strict();
function readWindow(directory: string) {
  const parsed = windowSchema.safeParse(readJson(path.join(directory, "window.json")));
  if (!parsed.success) return refuse("window record refused");
  return parsed.data;
}
function protectedPath(file: string, directory: boolean) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) refuse("storage path refused");
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) refuse("storage type refused");
  if (process.platform !== "win32") {
    if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) refuse("storage permissions refused");
    for (let parent = path.dirname(file);; parent = path.dirname(parent)) {
      const p = fs.lstatSync(parent);
      if (p.isSymbolicLink() || !p.isDirectory() || (p.mode & 0o022) !== 0) refuse("writable storage ancestor refused");
      if (parent === path.dirname(parent)) break;
    }
  }
  return stat;
}
function readProtected(file: string) {
  const stat = protectedPath(file, false);
  if (stat.size > 65536) refuse("retained file exceeds bound");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) refuse("retained file changed during read");
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
    if (bytes.length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) refuse("retained file changed during read");
    return bytes;
  } finally { fs.closeSync(fd); }
}
function readJson(file: string): unknown {
  try { return JSON.parse(readProtected(file).toString("utf8")); } catch { return refuse("retained record refused"); }
}
function syncDirectory(directory: string) {
  // Financial/provider admission lives on the POSIX host. Local buyer signing may call it over
  // authenticated SSH; Windows has no durable directory-fsync substitute in this implementation.
  const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function createRetained(directory: string, name: string, value: unknown, flush = syncDirectory) {
  const bytes = `${canonicalJson(value)}\n`, file = path.join(directory, name);
  let fd: number;
  try { fd = fs.openSync(file, "wx", 0o600); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  flush(directory);
  return true;
}
export function validateBusinessCanaryPolicy(value: unknown, now = new Date()): BusinessCanaryPolicy {
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) return refuse("policy refused");
  const policy = parsed.data, intent = policy.original;
  if (policy.executionHostSha256 !== businessCanaryHostIdentity()) return refuse("execution host/user binding refused");
  if (now.toISOString().slice(0, 10) !== policy.priceCheckedOn || now.getTime() < Date.parse(policy.approvedAt) ||
      now.getTime() >= Date.parse(policy.expiresAt)) refuse("expired or outside reviewed supplier day");
  if (intent.request.researchMode !== "quick" || intent.request.budget !== 0.01 ||
      BigInt(intent.requirement.amount) > BigInt(50000) || BigInt(intent.requirement.amount) <= BigInt(10000) ||
      BigInt(intent.authorization.validAfter) > BigInt(Math.floor(now.getTime() / 1000)) ||
      BigInt(intent.authorization.validBefore) <= BigInt(Math.floor(now.getTime() / 1000))) refuse("original economics or time refused");
  return policy;
}
function windowRecord(configured: ConfiguredCanary) {
  return { format: "keryx-business-canary-window-v1", approvalId: configured.policy.approvalId,
    policyFile: configured.file, policySha256: configured.digest, queryId: configured.policy.original.queryId,
    maximumOriginals: 1, maximumMicroUsdc: 60000, maximumMicroUsd: 250000 };
}
function loadPolicy(file: string, digest: string, now?: Date): ConfiguredCanary {
  if (!/^[a-f0-9]{64}$/.test(digest)) refuse("configuration refused");
  const bytes = readProtected(file);
  if (sha(bytes) !== digest) refuse("policy digest changed");
  return { policy: validateBusinessCanaryPolicy(JSON.parse(bytes.toString("utf8")), now), file, digest,
    directory: businessCanaryDirectory() };
}
function configured(): ConfiguredCanary | null {
  const directory = businessCanaryDirectory(), window = path.join(directory, "window.json");
  const file = process.env.KERYX_BUSINESS_CANARY_FILE, digest = process.env.KERYX_BUSINESS_CANARY_SHA256;
  if (file === undefined && digest === undefined) {
    if (exists(directory)) {
      protectedPath(directory, true);
      // Closing is an explicit, evidence-checked operation; expiry/removal never releases holds.
      if (!retainedBusinessCanaryClosure())
        refuse("active registry requires its unchanged selectors");
    }
    return null;
  }
  if (!file || !digest) return refuse("partial configuration refused");
  const current = loadPolicy(file, digest);
  protectedPath(directory, true);
  if (!equal(readWindow(directory), windowRecord(current)) || exists(path.join(directory, "closed.json"))) refuse("window changed or already closed");
  return current;
}
export function configuredBusinessCanary(): BusinessCanaryPolicy | null { return configured()?.policy ?? null; }

/** Explicit provisioning only. No wallet/key, env mutation, funding or provider request. */
export function activateBusinessCanary(file: string, digest: string, flush = syncDirectory) {
  const current = loadPolicy(file, digest);
  protectedPath(current.directory, true);
  if (exists(path.join(current.directory, "closed.json"))) refuse("window already closed");
  createRetained(current.directory, "window.json", windowRecord(current), flush);
  if (!equal(readJson(path.join(current.directory, "window.json")), windowRecord(current))) refuse("window already belongs to another original");
  return current.policy;
}
export function readPreparedBusinessCanaryIntent(file: string): BuyerIntent {
  return buyerIntentSchemaForProfile(ARC_MAINNET_PROFILE).parse(readJson(file));
}
function originalRecord(current: ConfiguredCanary) {
  return { format: "keryx-business-canary-original-v1", policySha256: current.digest,
    queryId: current.policy.original.queryId, intentSha256: sha(canonicalJson(current.policy.original)),
    reservedMicroUsdc: 60000, outcome: "held-regardless-of-original-outcome" };
}
export function assertPreparedCanarySubmission(intent: BuyerIntent, flush = syncDirectory): void {
  const current = configured(); if (!current) { assertNoFailedCanaryAdmission(); return; }
  if (!equal(intent, current.policy.original)) refuse("prepared original mismatch");
  createRetained(current.directory, "original.json", originalRecord(current), flush);
  if (!equal(readJson(path.join(current.directory, "original.json")), originalRecord(current))) refuse("original hold changed");
  configured(); // Expiry/config may cross durable admission. Retain the hold and refuse dispatch.
}
export function assertCanaryOriginalReserved(): void {
  const current = configured(); if (!current) return refuse("active original unavailable");
  if (!equal(readJson(path.join(current.directory, "original.json")), originalRecord(current))) return refuse("original hold refused");
}
function settlementRecord(current: ConfiguredCanary) {
  return { format: "keryx-business-canary-inbound-attempt-v1", policySha256: current.digest,
    queryId: current.policy.original.queryId, outcome: "held-regardless-of-facilitator-outcome" };
}
/** One possible inbound settlement exposure on the shared host, before vendor HTTP. */
export function reserveCanaryInboundSettlement(flush = syncDirectory): void {
  const current = configured(); if (!current) { assertNoFailedCanaryAdmission(); return; }
  assertCanaryOriginalReserved();
  if (!createRetained(current.directory, "inbound-settlement.json", settlementRecord(current), flush))
    return refuse("inbound attempt already consumed; recover the original with GET");
  if (!equal(readJson(path.join(current.directory, "inbound-settlement.json")), settlementRecord(current)))
    return refuse("inbound attempt readback refused");
  configured();
}

interface CanaryRunInput { queryId: string; question: string; budget?: number; origin?: string;
  researchMode?: string; fundingOwner?: string; privateScope: boolean; paidScholarly?: boolean }
export interface BusinessCanaryAdmission { readonly queryId: string }
interface AdmissionState { current: ConfiguredCanary; open: boolean; signal?: AbortSignal; flush: (directory: string) => void }
const admitted = new WeakMap<BusinessCanaryAdmission, AdmissionState>();
const context = new AsyncLocalStorage<BusinessCanaryAdmission>();
export function admitBusinessCanaryRun(input: CanaryRunInput, flush = syncDirectory): BusinessCanaryAdmission | null {
  const current = configured();
  if (!current) {
    if (canaryExecutionPaused() && (input.privateScope || input.paidScholarly ||
      !["engine", "web", "mcp"].includes(input.origin ?? "engine") ||
      input.queryId === retainedFailedBusinessCanaryAuthority().original.queryId)) assertNoFailedCanaryAdmission();
    assertOrdinaryCanarySupplierAdmission(); return null;
  }
  const expected = current.policy.original;
  if (input.queryId !== expected.queryId || input.question !== expected.request.question || input.budget !== 0.01 ||
      input.origin !== "a2a" || input.researchMode !== "quick" || input.fundingOwner !== "treasury" ||
      input.privateScope || input.paidScholarly) refuse("execution is not the admitted paid original");
  if (!equal(readJson(path.join(current.directory, "original.json")), originalRecord(current))) refuse("original was not reserved before submission");
  const token = Object.freeze({ queryId: input.queryId });
  admitted.set(token, { current, open: true, flush }); return token;
}
export function bindBusinessCanaryAdmission<T, R>(token: BusinessCanaryAdmission,
  generator: AsyncGenerator<T, R, void>, signal?: AbortSignal): AsyncGenerator<T, R, void> {
  const state = admitted.get(token); if (!state?.open) return refuse("invalid execution admission");
  state.signal = signal;
  const close = () => { state.open = false; signal?.removeEventListener("abort", close); };
  signal?.addEventListener("abort", close, { once: true }); if (signal?.aborted) close();
  const resume = (operation: "next" | "return" | "throw", value?: unknown) => context.run(token, async () => {
    if (!state.open && operation === "next") return refuse("execution admission revoked");
    try {
      const result = await (generator[operation] as (v?: unknown) => Promise<IteratorResult<T, R>>)(value);
      if (result.done) close(); return result;
    } catch (error) { close(); throw error; }
  });
  return { next: value => resume("next", value), return: value => { close(); return resume("return", value); },
    throw: error => { close(); return resume("throw", error); }, [Symbol.asyncIterator]() { return this; },
    async [Symbol.asyncDispose]() { close(); await resume("return"); } };
}
function reserve(kind: "model" | "search", detail: Record<string, string | number>) {
  const current = configured(); if (!current) {
    if (context.getStore()) return refuse("retained execution admission revoked");
    return;
  }
  const token = context.getStore(), state = token && admitted.get(token);
  if (!state?.open || state.signal?.aborted || state.current.digest !== current.digest ||
      state.current.file !== current.file) return refuse("provider requires current opaque execution admission");
  if (!equal(readJson(path.join(current.directory, "original.json")), originalRecord(current))) refuse("original hold changed");
  const maximum = kind === "model" ? 11 : 2, price = kind === "model" ? 20660 : 8000;
  // This provisioned ledger is external private runtime data, never a build asset.
  for (const name of fs.readdirSync(/* turbopackIgnore: true */ current.directory)) {
    if (["window.json", "original.json"].includes(name)) continue;
    if (name === "inbound-settlement.json") {
      if (!equal(readJson(path.join(current.directory, name)), settlementRecord(current))) refuse("inbound attempt changed");
      continue;
    }
    const match = /^(model|search)-([0-9]{2})\.json$/.exec(name);
    if (!match || +match[2] < 1 || +match[2] > (match[1] === "model" ? 11 : 2)) refuse("unexpected retained ledger state");
    // Interrupted/empty slots consume their full maximum; never parse them as refundable zero.
    protectedPath(path.join(current.directory, name), false);
  }
  for (let slot = 1; slot <= maximum; slot++) {
    if (createRetained(current.directory, `${kind}-${String(slot).padStart(2, "0")}.json`, {
      format: "keryx-business-canary-provider-hold-v1", policySha256: current.digest,
      queryId: token!.queryId, kind, slot, reservedAt: new Date().toISOString(), reserveMicroUsd: price,
      ...detail, outcome: "held-regardless-of-provider-outcome" }, state.flush)) { configured(); return; }
  }
  refuse("provider ceiling exhausted");
}
export function reserveCanaryModel(system: string, user: string, maxTokens: number): void {
  if (!configuredBusinessCanary()) { assertNoFailedCanaryAdmission(); if (context.getStore()) return refuse("retained execution admission revoked"); return; }
  const inputBytes = Buffer.byteLength(system + " Respond with a single JSON object." + user, "utf8");
  if (inputBytes > 32000 || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) refuse("model input/output ceiling exceeded");
  reserve("model", { inputBytes, maximumOutputTokens: maxTokens });
}
export function reserveCanarySearch(query: string): void {
  if (!configuredBusinessCanary()) { assertOrdinaryCanarySupplierAdmission(); return; }
  if (query.length > 500) refuse("search query ceiling exceeded");
  reserve("search", { querySha256: sha(query), searchDepth: "basic" });
}
export function canaryOriginalClaim(): A2aOriginalClaim | undefined {
  const current = configured(); if (!current) return undefined;
  return originalClaimForPolicy(current.policy);
}
function originalClaimForPolicy(policy: BusinessCanaryPolicy): A2aOriginalClaim {
  const i = policy.original, pkg = a2aResearchPackageForVersion("quick", "1.0.0");
  if (!pkg) return refuse("package unavailable");
  const creator = 10000, amount = Number(i.requirement.amount), fee = amount - creator;
  return { id: i.queryId, queryId: i.queryId, requestHash: a2aRequestHash({ question: i.request.question,
    creatorBudgetUsdc: 0.01, serviceFeeUsdc: fee / 1e6, researchMode: "quick", researchPackage: pkg }),
    payer: i.authorization.from.toLowerCase(), payee: i.authorization.to.toLowerCase(),
    authorizationId: i.authorization.nonce, amountMicroUsdc: String(amount), creatorBudgetMicroUsdc: "10000",
    serviceFeeMicroUsdc: String(fee), packageFingerprint: a2aResearchPackageFingerprint(pkg),
    network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),
    gatewayContract: ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase() };
}
export function assertCanaryCreatorPayment(): void { if (context.getStore() || canaryExecutionPaused()) refuse("creator payment forbidden for this catalog-empty original"); }
export function canaryExecutionPaused(): boolean {
  try { return configuredBusinessCanary() !== null || retainedBusinessCanaryClosure()?.admissionPaused === true; }
  catch { return true; }
}
/** The Operator's unresolved paid obligation remains held. Unrelated research
 * can resume only after explicit native verification of an expired failed claim. */
export function canaryResearchPaused(): boolean {
  try {
    if (configuredBusinessCanary() !== null) return true;
    const closed = retainedBusinessCanaryClosure();
    return closed?.admissionPaused === true && !retainedCanaryResearchIsolation(retainedFailedBusinessCanaryAuthority());
  } catch { return true; }
}
/** Ordinary transports/probes cannot spend outside the fixed admitted canary engine. */
export function assertOrdinaryCanarySupplierAdmission(): void {
  if (context.getStore() || canaryResearchPaused()) refuse("ordinary supplier transport is held");
}

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const providerLedgerSchema = z.object({ sha256: digestSchema,
  modelCalls: z.number().int().min(0).max(BUSINESS_CANARY_REVIEW.maximumModelCalls),
  searchCalls: z.number().int().min(0).max(BUSINESS_CANARY_REVIEW.maximumSearchCalls),
  reservedMicroUsd: z.number().int().min(0).max(BUSINESS_CANARY_REVIEW.maximumMicroUsd) }).strict();
const failedProofSchema = z.object({ outcome: z.literal("verified-failed-original"),
  paidDeliveryObligation: z.literal("unresolved"), deliveryCompleted: z.literal(false), refunded: z.literal(false),
  admissionPaused: z.literal(true), originalEvidenceSha256: digestSchema, providerLedger: providerLedgerSchema }).strict();
const failedClosureSchema = failedProofSchema.extend({ format: z.literal("keryx-business-canary-closed-v1"),
  policySha256: digestSchema, queryId: z.string().regex(/^a2a_[a-f0-9]{64}$/) }).strict();
export type FailedBusinessCanaryProof = z.infer<typeof failedProofSchema>;
export type BusinessCanaryClosure = FailedBusinessCanaryProof | {
  outcome: "verified-completed-original"; admissionPaused: false; paidDeliveryObligation: "resolved";
} | {
  outcome: "verified-fulfilled-original"; admissionPaused: false; paidDeliveryObligation: "resolved";
  deliveryCompleted: true; refunded: false; noNewInboundPayment: true;
};
export type FailedBusinessCanaryProofDb = Pick<KeryxDB,
  "getA2aOrder" | "getQueryRun" | "hasA2aOriginalSettlement" | "listCreatorPaymentAttemptsByQuery">;

function terminalCanaryContext(): ConfiguredCanary {
  const directory = businessCanaryDirectory(); protectedPath(directory, true);
  const retained = readWindow(directory);
  // Metadata inspection grants no renewed supplier permission, including after expiry.
  const current = loadPolicy(retained.policyFile, retained.policySha256,
    new Date(Date.parse(BUSINESS_CANARY_REVIEW.supplierExpiresAt) - 1));
  if (!equal(retained, windowRecord(current))) return refuse("terminal window changed");
  return current;
}
const providerHoldBase = { format: z.literal("keryx-business-canary-provider-hold-v1"), policySha256: digestSchema,
  queryId: z.string(), slot: z.number().int().positive(), reservedAt: z.string().datetime(),
  outcome: z.literal("held-regardless-of-provider-outcome") };
const providerHoldSchema = z.discriminatedUnion("kind", [
  z.object({ ...providerHoldBase, kind: z.literal("model"), reserveMicroUsd: z.literal(BUSINESS_CANARY_REVIEW.modelReserveMicroUsd),
    inputBytes: z.number().int().min(1).max(32000), maximumOutputTokens: z.number().int().min(1).max(8192) }).strict(),
  z.object({ ...providerHoldBase, kind: z.literal("search"), reserveMicroUsd: z.literal(BUSINESS_CANARY_REVIEW.searchReserveMicroUsd),
    querySha256: digestSchema, searchDepth: z.literal("basic") }).strict(),
]);
function retainedProviderLedger(current: ConfiguredCanary) {
  const required = { "window.json": windowRecord(current), "original.json": originalRecord(current),
    "inbound-settlement.json": settlementRecord(current) };
  const names = fs.readdirSync(/* turbopackIgnore: true */ current.directory).sort();
  const entries: Array<{ name: string; sha256: string }> = []; let modelCalls = 0, searchCalls = 0;
  for (const name of names) {
    if (name === "closed.json") continue;
    const bytes = readProtected(path.join(current.directory, name)); let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { return refuse("provider ledger incomplete"); }
    if (Object.hasOwn(required, name)) {
      if (!equal(value, required[name as keyof typeof required])) return refuse("retained original ledger changed");
    } else {
      const match = /^(model|search)-([0-9]{2})\.json$/.exec(name), parsed = providerHoldSchema.safeParse(value);
      if (!match || !parsed.success) return refuse("provider ledger record refused");
      const hold = parsed.data, maximum = hold.kind === "model" ? BUSINESS_CANARY_REVIEW.maximumModelCalls : BUSINESS_CANARY_REVIEW.maximumSearchCalls;
      const at = Date.parse(hold.reservedAt);
      if (hold.kind !== match[1] || hold.slot !== Number(match[2]) || hold.slot > maximum ||
        hold.policySha256 !== current.digest || hold.queryId !== current.policy.original.queryId ||
        new Date(at).toISOString() !== hold.reservedAt || at < Date.parse(current.policy.approvedAt) ||
        at >= Date.parse(current.policy.expiresAt) || at > Date.now()) return refuse("provider ledger binding refused");
      if (hold.kind === "model") modelCalls++; else searchCalls++;
    }
    entries.push({ name, sha256: sha(bytes) });
  }
  if (!Object.keys(required).every(name => names.includes(name))) return refuse("retained original ledger incomplete");
  for (const [kind, count] of [["model", modelCalls], ["search", searchCalls]] as const)
    for (let slot = 1; slot <= count; slot++) if (!names.includes(`${kind}-${String(slot).padStart(2, "0")}.json`))
      return refuse("provider ledger slot missing");
  if (!equal(names, fs.readdirSync(/* turbopackIgnore: true */ current.directory).sort())) return refuse("provider ledger changed during inspection");
  return providerLedgerSchema.parse({ sha256: sha(canonicalJson(entries)), modelCalls, searchCalls,
    reservedMicroUsd: modelCalls * BUSINESS_CANARY_REVIEW.modelReserveMicroUsd + searchCalls * BUSINESS_CANARY_REVIEW.searchReserveMicroUsd });
}
/** Filesystem-only retained closure observation. Failed delivery remains a persistent
 * admission hold even when selectors are removed; it is not completion or refund. */
export function retainedBusinessCanaryClosure(): BusinessCanaryClosure | null {
  const directory = businessCanaryDirectory(); if (!exists(directory)) return null;
  protectedPath(directory, true); const retained = readWindow(directory), file = path.join(directory, "closed.json");
  if (!exists(file)) return null;
  const value = readJson(file);
  if (equal(value, { format: "keryx-business-canary-closed-v1", policySha256: retained.policySha256,
    queryId: retained.queryId, outcome: "verified-completed-original" }))
    return { outcome: "verified-completed-original", admissionPaused: false, paidDeliveryObligation: "resolved" };
  const parsed = failedClosureSchema.safeParse(value);
  if (!parsed.success || parsed.data.policySha256 !== retained.policySha256 || parsed.data.queryId !== retained.queryId)
    return refuse("terminal closure record refused");
  const current = terminalCanaryContext(), providerLedger = retainedProviderLedger(current);
  if (!equal(parsed.data.providerLedger, providerLedger)) return refuse("closed provider ledger changed");
  const delivered = retainedFulfillmentDeliveryResolution(retainedFailedBusinessCanaryAuthority());
  if (delivered) return delivered;
  return failedProofSchema.parse({ outcome: parsed.data.outcome, paidDeliveryObligation: parsed.data.paidDeliveryObligation,
    deliveryCompleted: parsed.data.deliveryCompleted, refunded: parsed.data.refunded, admissionPaused: parsed.data.admissionPaused,
    originalEvidenceSha256: parsed.data.originalEvidenceSha256, providerLedger });
}
/** Historical failed authority is observed independently of any later delivery marker.
 * No selector, native writer, supplier permission or financial retry is granted. */
export function retainedFailedBusinessCanaryAuthority() {
  const current = terminalCanaryContext();
  const bytes = readProtected(path.join(current.directory, "closed.json"));
  const closed = failedClosureSchema.parse(JSON.parse(bytes.toString("utf8")));
  const providerLedger = retainedProviderLedger(current);
  if (closed.policySha256 !== current.digest || closed.queryId !== current.policy.original.queryId ||
      !equal(closed.providerLedger, providerLedger)) return refuse("failed retained authority changed");
  return { original: originalClaimForPolicy(current.policy), question: current.policy.original.request.question,
    policySha256: current.digest, failedClosureSha256: sha(bytes),
    originalEvidenceSha256: closed.originalEvidenceSha256, originalProviderLedgerSha256: providerLedger.sha256,
    providerLedger };
}
export type RetainedFailedCanaryAuthority = ReturnType<typeof retainedFailedBusinessCanaryAuthority>;
function assertNoFailedCanaryAdmission() {
  if (retainedBusinessCanaryClosure()?.admissionPaused) refuse("unresolved paid delivery holds admission");
}
/** Exact readonly terminal proof. Compatible with the enrolled observation facade;
 * no ordinary initialization, schema migration, signer, provider or DB write. */
export async function verifyFailedBusinessCanary(db: FailedBusinessCanaryProofDb): Promise<FailedBusinessCanaryProof> {
  const current = terminalCanaryContext(), original = originalClaimForPolicy(current.policy);
  const before = retainedProviderLedger(current);
  if (typeof db.hasA2aOriginalSettlement !== "function") return refuse("terminal proof capability unavailable");
  const inspect = async () => {
    const order = await db.getA2aOrder(original.id);
    if (!order || !matchesA2aOriginalBinding(order, original) || order.request?.origin !== "a2a" ||
      order.request.question !== current.policy.original.request.question || order.status !== "failed" || order.errorCode !== "research_failed" ||
      order.executionJournalVersion !== 1 || !order.startedAt || typeof order.workerId !== "string" ||
      !order.workerId.trim() || order.workerId.length > 200 ||
      order.paymentStartedAt !== null || order.resultSavingAt !== null || order.response !== null || order.resolution !== null)
      return refuse("failed original proof incomplete");
    const created = Date.parse(order.createdAt), started = Date.parse(order.startedAt), updated = Date.parse(order.updatedAt);
    if (![created, started, updated].every(Number.isFinite) || new Date(started).toISOString() !== order.startedAt ||
      created < Date.parse(current.policy.approvedAt) || started < created || started >= Date.parse(current.policy.expiresAt) ||
      updated < started || updated > Date.now()) return refuse("failed original chronology refused");
    const [run, attempts, settled] = await Promise.all([db.getQueryRun(original.queryId),
      db.listCreatorPaymentAttemptsByQuery(original.queryId), db.hasA2aOriginalSettlement!(original)]);
    if (run !== null || !Array.isArray(attempts) || attempts.length !== 0 || settled !== true)
      return refuse("failed settled original proof incomplete");
    return sha(canonicalJson({ order, nativeExactOriginalSettled: true, queryRunFound: false, creatorAttempts: 0 }));
  };
  const originalEvidenceSha256 = await inspect();
  if (await inspect() !== originalEvidenceSha256 || !equal(before, retainedProviderLedger(current)))
    return refuse("failed original proof changed during inspection");
  const proof = failedProofSchema.parse({ outcome: "verified-failed-original", paidDeliveryObligation: "unresolved",
    deliveryCompleted: false, refunded: false, admissionPaused: true, originalEvidenceSha256, providerLedger: before });
  const closeFile = path.join(current.directory, "closed.json");
  if (exists(closeFile) && !equal(readJson(closeFile), failedClosureRecord(current, proof))) return refuse("failed closure proof changed");
  return proof;
}
function failedClosureRecord(current: ConfiguredCanary, proof: FailedBusinessCanaryProof) {
  return { format: "keryx-business-canary-closed-v1", policySha256: current.digest,
    queryId: current.policy.original.queryId, ...proof };
}
/** Lifecycle closure only: caller must positively drain all writers first. The
 * unresolved paid-delivery obligation keeps admission paused after selector removal. */
export async function closeVerifiedFailedBusinessCanary(db: FailedBusinessCanaryProofDb, flush = syncDirectory) {
  const current = terminalCanaryContext(), file = path.join(current.directory, "closed.json");
  if (exists(file)) return refuse("window already closed");
  const proof = await verifyFailedBusinessCanary(db);
  if (!createRetained(current.directory, "closed.json", failedClosureRecord(current, proof), flush)) return refuse("window already closed");
  if (!equal(readJson(file), failedClosureRecord(current, proof)) || !equal(await verifyFailedBusinessCanary(db), proof))
    return refuse("failed closure readback refused");
  return proof;
}

/** Only the trusted terminal-proof CLI calls this after native settled-original verification. */
export async function closeVerifiedBusinessCanary(db: KeryxDB, flush = syncDirectory) {
  const directory = businessCanaryDirectory(); protectedPath(directory, true);
  const retained = readWindow(directory);
  // Closing is metadata only and remains available after supplier expiry. It revalidates the
  // exact retained policy at its last permitted instant, never renewing provider permission.
  const current = loadPolicy(retained.policyFile, retained.policySha256,
    new Date(Date.parse(BUSINESS_CANARY_REVIEW.supplierExpiresAt) - 1));
  if (!equal(retained, windowRecord(current))) return refuse("terminal window changed");
  if (!equal(readJson(path.join(current.directory, "original.json")), originalRecord(current)))
    return refuse("terminal original hold refused");
  if (!equal(readJson(path.join(current.directory, "inbound-settlement.json")), settlementRecord(current)))
    return refuse("terminal inbound attempt refused");
  const original = originalClaimForPolicy(current.policy); if (!db.hasA2aOriginalSettlement) return refuse("terminal proof capability unavailable");
  const order = await db.getA2aOrder(original.id), run = await db.getQueryRun(original.queryId);
  if (!order || order.status !== "completed" || !run || run.paymentMode !== "real" ||
      run.id !== original.queryId || run.question !== current.policy.original.request.question || run.budget !== 0.01 ||
      run.researchMode !== "quick" || run.origin !== "a2a" || run.fundingOwner !== "treasury" ||
      !(await db.hasA2aOriginalSettlement(original)) || (await db.listCreatorPaymentAttemptsByQuery(original.queryId)).length !== 0)
    return refuse("terminal settled original proof incomplete");
  const { verifiedA2aResponseFromRun } = await import("../a2a/operator-resolution");
  await verifiedA2aResponseFromRun(db, order, run);
  const record = { format: "keryx-business-canary-closed-v1", policySha256: current.digest,
    queryId: original.queryId, outcome: "verified-completed-original" };
  createRetained(current.directory, "closed.json", record, flush);
  if (!equal(readJson(path.join(current.directory, "closed.json")), record)) return refuse("terminal close readback refused");
}
