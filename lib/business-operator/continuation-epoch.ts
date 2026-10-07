import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { fulfillmentSha256 as hash } from "../a2a/failed-original-fulfillment-protocol";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const nonempty = z.string().min(1);
function refuse(): never { throw new Error("Original continuation epoch authority uncertain; preserve every anchor, claim and reservation"); }

export const CONTINUATION_EPOCH2_LIMITS = Object.freeze({ parentModelCalls: 8, historicalReservedMicroUsd: 243_260,
  maximumNewModelCalls: 6, maximumCombinedMicroUsd: 400_000, reserveMicroUsd: 20_660 });
/** Extend the shared authorization object with these fixed V2 replacements. The
 * parent policy still validates all shared fields, native proof and parent ledger. */
export const continuationEpochAuthorizationFields = {
  format: z.literal("keryx-original-continuation-authorization-v2"),
  historicalReservedMicroUsd: z.literal(CONTINUATION_EPOCH2_LIMITS.historicalReservedMicroUsd),
  maximumNewModelCalls: z.literal(CONTINUATION_EPOCH2_LIMITS.maximumNewModelCalls),
  maximumCombinedMicroUsd: z.literal(CONTINUATION_EPOCH2_LIMITS.maximumCombinedMicroUsd),
  parentAuthorizationFile: nonempty, parentAuthorizationSha256: digest,
  parentProviderLedgerSha256: digest, parentLedgerHeadSha256: digest,
  contextProtocol: z.literal("full-selected-bodies-required-sufficiency-v1"),
};
const bindingSchema = z.object({ ...continuationEpochAuthorizationFields,
  authorizationFile: nonempty, authorizationSha256: digest,
  originalAuthorizationSha256: digest, nativeClaimSha256: digest, inputSemanticSha256: digest, packetSha256: digest,
  executionHostSha256: digest, executorCommit: z.string().regex(/^[a-f0-9]{40}$/),
  ownerAuthorizationSha256: digest, ownerAuthorizationReceivedAt: timestamp, approvedAt: timestamp,
  expiresAt: timestamp, maximumDurationMs: z.literal(86_400_000),
}).strict().refine(value => Date.parse(value.ownerAuthorizationReceivedAt) <= Date.parse(value.approvedAt) &&
  Date.parse(value.approvedAt) < Date.parse(value.expiresAt) &&
  Date.parse(value.expiresAt) - Date.parse(value.ownerAuthorizationReceivedAt) <= value.maximumDurationMs);
export type ContinuationEpochBinding = z.infer<typeof bindingSchema>;

export function fixedPaths(home: string) {
  if (!path.isAbsolute(home) || path.resolve(home) !== home) refuse();
  const base = path.join(home, ".local", "share");
  const anchorDirectory = path.join(base, "keryx-business-canary-continuation-epoch-authority");
  return { parentDirectory: path.join(base, "keryx-business-canary-continuation"),
    epochDirectory: path.join(base, "keryx-business-canary-continuation-epoch-2"), anchorDirectory,
    intentFile: path.join(anchorDirectory, "epoch-2-intent.json"),
    activeFile: path.join(anchorDirectory, "epoch-2-active.json"),
    lockFile: path.join(anchorDirectory, "activation-lock.json"),
    uncertainFile: path.join(anchorDirectory, "activation-uncertain.json"),
    frontierFile: path.join(anchorDirectory, "frontier.json"),
    ledgerUpdateLockFile: path.join(anchorDirectory, "ledger-update-lock.json"),
    ledgerUpdateUncertainFile: path.join(anchorDirectory, "ledger-update-uncertain.json") };
}
export type ContinuationEpochPaths = ReturnType<typeof fixedPaths>;

/** Reuse the parent policy's protected read/write primitives. Directory creation
 * must use 0700; records use exclusive 0600 + file/directory fsync and exact readback.
 * Normal release must compare protected raw bytes, unlink only its own lock and
 * fsync. A failed release retains a lock or exclusively writes the uncertainty marker. */
export interface ContinuationEpochIO {
  exists(file: string): boolean;
  read(file: string, maximumBytes?: number): Buffer;
  assertProtectedPath(file: string, directory: boolean): unknown;
  list(directory: string): readonly string[];
  ensureDirectory(directory: string): void;
  retainRecord(file: string, value: unknown): void;
  /** Exclusive temporary file, raw-SHA CAS, fsync/rename/directory fsync/readback. */
  replaceRecordExact(file: string, previousSha256: string, value: unknown): void;
  releaseRecordExact(file: string, sha256: string): void;
}
const intentSchema = z.object({ format: z.literal("keryx-original-continuation-epoch-intent-v1"),
  epoch: z.literal(2), binding: bindingSchema, activationId: digest, requestedAt: timestamp }).strict();
const activeSchema = z.object({ format: z.literal("keryx-original-continuation-epoch-active-v1"),
  epoch: z.literal(2), intentSha256: digest, authorizationFile: nonempty, authorizationSha256: digest,
  directory: nonempty, activatedAt: timestamp }).strict();
const retainedGrantSchema = z.object({ format: z.literal("keryx-original-continuation-retained-authorization-v1"),
  authorizationFile: nonempty, authorizationSha256: digest }).strict();
const frontierSchema = z.object({ format: z.literal("keryx-original-continuation-epoch-frontier-v1"),
  epoch: z.literal(2), intentSha256: digest, authorizationSha256: digest, directory: nonempty,
  ledgerHeadSha256: digest, updatedAt: timestamp }).strict();
const recordBytes = (value: unknown) => Buffer.from(`${canonicalJson(value)}\n`);
const object = (bytes: Buffer): Record<string, unknown> => {
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  return value;
};
function outside(file: string, directories: string[]) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file) refuse();
  for (const directory of directories) {
    const relative = path.relative(directory, file);
    if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) refuse();
  }
}
function assertSources(paths: ContinuationEpochPaths, binding: ContinuationEpochBinding, io: ContinuationEpochIO) {
  // The new grant exists independently before the new journal is created. No
  // grant may be inserted into the immutable parent or external anchor records.
  outside(binding.authorizationFile, [paths.parentDirectory, paths.epochDirectory, paths.anchorDirectory]);
  outside(binding.parentAuthorizationFile, [paths.parentDirectory, paths.epochDirectory, paths.anchorDirectory]);
  const grant = io.read(binding.authorizationFile, 65_536);
  if (hash(grant) !== binding.authorizationSha256 || hash(io.read(binding.parentAuthorizationFile, 65_536)) !== binding.parentAuthorizationSha256 ||
    hash(io.read(path.join(paths.parentDirectory, "ledger-head.json"), 65_536)) !== binding.parentLedgerHeadSha256) refuse();
  const fields = object(grant);
  for (const [key, value] of Object.entries(binding)) {
    if (key !== "authorizationFile" && key !== "authorizationSha256" && fields[key] !== value) refuse();
  }
}
function assertJournal(paths: ContinuationEpochPaths, binding: ContinuationEpochBinding, io: ContinuationEpochIO) {
  if (!io.exists(paths.epochDirectory)) refuse();
  io.assertProtectedPath(paths.epochDirectory, true);
  const retained = retainedGrantSchema.parse(object(io.read(path.join(paths.epochDirectory, "authorization.json"), 65_536)));
  if (retained.authorizationFile !== binding.authorizationFile || retained.authorizationSha256 !== binding.authorizationSha256) refuse();
  io.assertProtectedPath(path.join(paths.epochDirectory, "ledger-head.json"), false);
  assertSources(paths, binding, io);
}
function assertFreshWindow(binding: ContinuationEpochBinding) {
  if (Date.now() < Date.parse(binding.approvedAt) || Date.now() >= Date.parse(binding.expiresAt)) refuse();
}
function assertEmpty(paths: ContinuationEpochPaths, io: ContinuationEpochIO) {
  if (io.exists(paths.epochDirectory) || io.exists(paths.intentFile) || io.exists(paths.activeFile) ||
    io.exists(paths.lockFile) || io.exists(paths.uncertainFile) || io.exists(paths.frontierFile) ||
    io.exists(paths.ledgerUpdateLockFile) || io.exists(paths.ledgerUpdateUncertainFile)) refuse();
  if (io.exists(paths.anchorDirectory)) {
    io.assertProtectedPath(paths.anchorDirectory, true);
    if (io.list(paths.anchorDirectory).length) refuse();
  }
}
const pending = (paths: ContinuationEpochPaths, io: ContinuationEpochIO) => [paths.lockFile, paths.uncertainFile,
  paths.ledgerUpdateLockFile, paths.ledgerUpdateUncertainFile].some(file => io.exists(file));
function readFrontier(paths: ContinuationEpochPaths, io: ContinuationEpochIO) {
  const raw = io.read(paths.frontierFile, 65_536);
  return { raw, sha256: hash(raw), frontier: frontierSchema.parse(object(raw)) };
}

/** Null means no epoch was ever activated or left uncertain. A partial/missing
 * new journal after any anchor, or an activation lock, always refuses fallback. */
export function readActiveEpochAnchor(home: string, io: ContinuationEpochIO) {
  const paths = fixedPaths(home);
  if (pending(paths, io)) refuse();
  const intentExists = io.exists(paths.intentFile), activeExists = io.exists(paths.activeFile);
  if (!intentExists && !activeExists) { assertEmpty(paths, io); return null; }
  if (!intentExists || !activeExists) refuse();
  io.assertProtectedPath(paths.anchorDirectory, true);
  if (canonicalJson([...io.list(paths.anchorDirectory)].sort()) !== canonicalJson([
    path.basename(paths.activeFile), path.basename(paths.intentFile), path.basename(paths.frontierFile)].sort())) refuse();
  const intentBytes = io.read(paths.intentFile, 65_536), activeBytes = io.read(paths.activeFile, 65_536);
  const intent = intentSchema.parse(object(intentBytes)), active = activeSchema.parse(object(activeBytes));
  if (active.intentSha256 !== hash(intentBytes) || active.directory !== paths.epochDirectory ||
    active.authorizationFile !== intent.binding.authorizationFile || active.authorizationSha256 !== intent.binding.authorizationSha256 ||
    Date.parse(intent.requestedAt) < Date.parse(intent.binding.approvedAt) || Date.parse(intent.requestedAt) >= Date.parse(intent.binding.expiresAt) ||
    Date.parse(active.activatedAt) < Date.parse(intent.requestedAt) || Date.parse(active.activatedAt) >= Date.parse(intent.binding.expiresAt) ||
    Date.parse(active.activatedAt) > Date.now()) refuse();
  assertJournal(paths, intent.binding, io);
  const current = readFrontier(paths, io);
  if (current.frontier.intentSha256 !== hash(intentBytes) || current.frontier.authorizationSha256 !== intent.binding.authorizationSha256 ||
    current.frontier.directory !== paths.epochDirectory ||
    current.frontier.ledgerHeadSha256 !== hash(io.read(path.join(paths.epochDirectory, "ledger-head.json"), 65_536)) ||
    Date.parse(current.frontier.updatedAt) < Date.parse(intent.requestedAt) || Date.parse(current.frontier.updatedAt) > Date.now()) refuse();
  if (pending(paths, io) ||
    !io.read(paths.intentFile, 65_536).equals(intentBytes) || !io.read(paths.activeFile, 65_536).equals(activeBytes)) refuse();
  return { paths, binding: intent.binding, intentSha256: hash(intentBytes), activeSha256: hash(activeBytes),
    frontierSha256: current.sha256, ledgerHeadSha256: current.frontier.ledgerHeadSha256 };
}

export interface ContinuationEpochActivation {
  /** Re-read the exact V2 grant, all eight closed parent holds/attempts, host/source,
   * current supplier window and the same fresh native failed-original proof. */
  validateAuthority(): Promise<void>;
  /** Only called after durable external intent. Initialize the fresh protected
   * journal's retained grant and ledger head using explicit-directory primitives. */
  initializeJournal(paths: ContinuationEpochPaths, binding: ContinuationEpochBinding): void;
}

/** One irreversible epoch-2 activation. A crash or failed acknowledgement keeps
 * its external lock/intent; there is no recovery by age, PID or reusing a grant. */
export async function activateEpochAnchor(home: string, value: ContinuationEpochBinding, io: ContinuationEpochIO,
  activation: ContinuationEpochActivation) {
  const paths = fixedPaths(home), binding = bindingSchema.parse(value);
  assertEmpty(paths, io);
  assertFreshWindow(binding);
  assertSources(paths, binding, io);
  await activation.validateAuthority();
  assertEmpty(paths, io);
  assertFreshWindow(binding);
  assertSources(paths, binding, io);
  io.ensureDirectory(paths.anchorDirectory);
  io.assertProtectedPath(paths.anchorDirectory, true);
  assertEmpty(paths, io);
  const requestedAt = new Date().toISOString(), activationId = randomBytes(32).toString("hex");
  const lock = { format: "keryx-original-continuation-epoch-activation-lock-v1", epoch: 2,
    authorizationSha256: binding.authorizationSha256, activationId, requestedAt };
  const lockBytes = recordBytes(lock);
  io.retainRecord(paths.lockFile, lock);
  if (!io.read(paths.lockFile, 65_536).equals(lockBytes)) refuse();
  const intent = intentSchema.parse({ format: "keryx-original-continuation-epoch-intent-v1", epoch: 2,
    binding, activationId, requestedAt }), intentBytes = recordBytes(intent);
  io.retainRecord(paths.intentFile, intent);
  if (!io.read(paths.intentFile, 65_536).equals(intentBytes)) refuse();
  if (io.exists(paths.epochDirectory)) refuse();
  activation.initializeJournal(paths, binding);
  assertJournal(paths, binding, io);
  const frontier = frontierSchema.parse({ format: "keryx-original-continuation-epoch-frontier-v1", epoch: 2,
    intentSha256: hash(intentBytes), authorizationSha256: binding.authorizationSha256, directory: paths.epochDirectory,
    ledgerHeadSha256: hash(io.read(path.join(paths.epochDirectory, "ledger-head.json"), 65_536)), updatedAt: new Date().toISOString() });
  io.retainRecord(paths.frontierFile, frontier);
  if (!io.read(paths.frontierFile, 65_536).equals(recordBytes(frontier))) refuse();
  await activation.validateAuthority();
  assertFreshWindow(binding);
  assertJournal(paths, binding, io);
  if (!io.read(paths.lockFile, 65_536).equals(lockBytes) || !io.read(paths.intentFile, 65_536).equals(intentBytes)) refuse();
  const active = activeSchema.parse({ format: "keryx-original-continuation-epoch-active-v1", epoch: 2,
    intentSha256: hash(intentBytes), authorizationFile: binding.authorizationFile,
    authorizationSha256: binding.authorizationSha256, directory: paths.epochDirectory, activatedAt: new Date().toISOString() });
  io.retainRecord(paths.activeFile, active);
  if (!io.read(paths.activeFile, 65_536).equals(recordBytes(active))) refuse();
  // Only this invocation owns this exact lock, and only acknowledged publication
  // reaches normal release. Every earlier failure leaves it untouched.
  try { io.releaseRecordExact(paths.lockFile, hash(lockBytes)); }
  catch (error) {
    if (!io.exists(paths.uncertainFile)) io.retainRecord(paths.uncertainFile, {
      format: "keryx-original-continuation-epoch-activation-uncertain-v1", epoch: 2,
      authorizationSha256: binding.authorizationSha256, activationId });
    throw error;
  }
  const result = readActiveEpochAnchor(home, io);
  if (!result || result.intentSha256 !== hash(intentBytes)) refuse();
  return result;
}

export interface ContinuationEpochLedgerUpdate { readonly _continuationEpochLedgerUpdate?: never }
interface UpdateState {
  home: string; paths: ContinuationEpochPaths; binding: ContinuationEpochBinding;
  prior: ReturnType<typeof readFrontier>; intentSha256: string; lockBytes: Buffer;
  io: ContinuationEpochIO; open: boolean;
}
const updates = new WeakMap<object, UpdateState>();

/** External write intent precedes every new journal record/head mutation. A
 * process-local token cannot recover or take over an old pending intent. */
export function beginEpochLedgerUpdate(home: string, io: ContinuationEpochIO): ContinuationEpochLedgerUpdate {
  const anchor = readActiveEpochAnchor(home, io);
  if (!anchor) refuse();
  const prior = readFrontier(anchor.paths, io);
  if (prior.sha256 !== anchor.frontierSha256) refuse();
  const value = { format: "keryx-original-continuation-epoch-ledger-update-lock-v1", epoch: 2,
    updateId: randomBytes(32).toString("hex"), authorizationSha256: anchor.binding.authorizationSha256,
    intentSha256: anchor.intentSha256, priorFrontierSha256: prior.sha256,
    priorLedgerHeadSha256: anchor.ledgerHeadSha256, startedAt: new Date().toISOString() };
  const lockBytes = recordBytes(value);
  io.retainRecord(anchor.paths.ledgerUpdateLockFile, value);
  if (!io.read(anchor.paths.ledgerUpdateLockFile, 65_536).equals(lockBytes) ||
    !io.read(anchor.paths.frontierFile, 65_536).equals(prior.raw) ||
    hash(io.read(path.join(anchor.paths.epochDirectory, "ledger-head.json"), 65_536)) !== prior.frontier.ledgerHeadSha256) refuse();
  const token = Object.freeze({});
  updates.set(token, { home, paths: anchor.paths, binding: anchor.binding, prior,
    intentSha256: anchor.intentSha256, lockBytes, io, open: true });
  return token;
}

/** Commit the latest raw journal head outside the mutable journal. A rollback of
 * the whole journal no longer resets consumed holds. Any uncertainty keeps the
 * external pending lock and refuses all supplier admission and fallback. */
export function completeEpochLedgerUpdate(token: ContinuationEpochLedgerUpdate, newHeadSha256: string,
  io: ContinuationEpochIO) {
  const state = token && typeof token === "object" ? updates.get(token) : undefined;
  if (!state?.open || state.io !== io) refuse();
  state.open = false;
  digest.parse(newHeadSha256);
  const { paths, prior, lockBytes } = state;
  if (io.exists(paths.lockFile) || io.exists(paths.uncertainFile) || io.exists(paths.ledgerUpdateUncertainFile) ||
    !io.read(paths.ledgerUpdateLockFile, 65_536).equals(lockBytes) ||
    !io.read(paths.frontierFile, 65_536).equals(prior.raw) ||
    newHeadSha256 === prior.frontier.ledgerHeadSha256 || Date.now() < Date.parse(prior.frontier.updatedAt) ||
    hash(io.read(path.join(paths.epochDirectory, "ledger-head.json"), 65_536)) !== newHeadSha256) refuse();
  assertJournal(paths, state.binding, io);
  if (hash(io.read(paths.intentFile, 65_536)) !== state.intentSha256) refuse();
  const value = frontierSchema.parse({ ...prior.frontier, ledgerHeadSha256: newHeadSha256, updatedAt: new Date().toISOString() });
  io.replaceRecordExact(paths.frontierFile, prior.sha256, value);
  if (!io.read(paths.frontierFile, 65_536).equals(recordBytes(value)) ||
    !io.read(paths.ledgerUpdateLockFile, 65_536).equals(lockBytes) ||
    hash(io.read(path.join(paths.epochDirectory, "ledger-head.json"), 65_536)) !== newHeadSha256) refuse();
  try { io.releaseRecordExact(paths.ledgerUpdateLockFile, hash(lockBytes)); }
  catch (error) {
    if (!io.exists(paths.ledgerUpdateUncertainFile)) io.retainRecord(paths.ledgerUpdateUncertainFile, {
      format: "keryx-original-continuation-epoch-ledger-update-uncertain-v1", epoch: 2,
      authorizationSha256: state.binding.authorizationSha256, lockSha256: hash(lockBytes) });
    throw error;
  }
  const anchor = readActiveEpochAnchor(state.home, io);
  if (!anchor || anchor.ledgerHeadSha256 !== newHeadSha256) refuse();
  return anchor;
}
