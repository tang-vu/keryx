import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { inspectExpiredUnpreparedFulfillment } from "./fulfillment-policy";
import { configuredBusinessCanary, retainedFailedBusinessCanaryAuthority, verifyFailedBusinessCanary,
  type FailedBusinessCanaryProofDb, type RetainedFailedCanaryAuthority } from "./canary-policy";
import type { KeryxDB } from "../db/keryx-db";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ format: z.literal("keryx-failed-canary-research-isolation-v1"),
  recordedAt: z.string().datetime(), evidenceSha256: digest,
  originalDelivered: z.literal(false), originalRefunded: z.literal(false),
  paidDeliveryObligation: z.literal("unresolved"), operatorAdmissionPaused: z.literal(true),
  ordinaryResearchRestored: z.literal(true), newSupplierAuthority: z.literal(false) }).strict();
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const refuse = (): never => { throw Error("Failed canary isolation refused; preserve the original and every claim and hold"); };
export const canaryResearchIsolationDirectory = () => path.join(os.homedir(), ".local", "share", "keryx-business-canary-research-isolation");
function exists(file: string) {
  try { fs.lstatSync(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
function protectedPath(file: string, directory: boolean) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) refuse();
  const s = fs.lstatSync(file);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1 || s.size > 65536)) refuse();
  if (process.platform !== "win32") {
    if (s.uid !== process.getuid!() || (s.mode & 0o777) !== (directory ? 0o700 : 0o600)) refuse();
    for (let parent = path.dirname(file);; parent = path.dirname(parent)) {
      const p = fs.lstatSync(parent);
      if (!p.isDirectory() || p.isSymbolicLink() || (p.mode & 0o022) !== 0 || p.uid !== 0 && p.uid !== process.getuid!()) refuse();
      if (parent === path.dirname(parent)) break;
    }
  }
  return s;
}
function readMarker() {
  const directory = canaryResearchIsolationDirectory(), file = path.join(directory, "isolated.json");
  if (!exists(directory)) return null;
  protectedPath(directory, true);
  if (!same(fs.readdirSync(directory).sort(), ["isolated.json"])) refuse();
  const before = protectedPath(file, false);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const signature = (s: fs.Stats) => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.mode, s.nlink].join(":");
  try {
    if (signature(fs.fstatSync(fd)) !== signature(before)) refuse();
    const bytes = fs.readFileSync(fd);
    if (bytes.length !== before.size || signature(fs.fstatSync(fd)) !== signature(before) || signature(protectedPath(file, false)) !== signature(before)) refuse();
    const marker = schema.parse(JSON.parse(bytes.toString("utf8")));
    if (new Date(marker.recordedAt).toISOString() !== marker.recordedAt || Date.parse(marker.recordedAt) > Date.now()) refuse();
    return marker;
  } finally { fs.closeSync(fd); }
}
function evidence(old: RetainedFailedCanaryAuthority) {
  if (configuredBusinessCanary() !== null) refuse();
  const partial = inspectExpiredUnpreparedFulfillment();
  if (!same(partial.claim.authority.original, old.original) || partial.claim.authority.failedClosureSha256 !== old.failedClosureSha256) refuse();
  return { old, partial };
}
/** A protected marker narrows the expired failed canary hold to Operator. The
 * ordinary request still needs its own existing compute and payment admission. */
export function retainedCanaryResearchIsolation(old: RetainedFailedCanaryAuthority): boolean {
  const marker = readMarker();
  if (!marker) return false;
  const current = evidence(old);
  if (marker.evidenceSha256 !== hash(current) || Date.parse(marker.recordedAt) < Date.parse(current.partial.expiresAt)) refuse();
  return true;
}
type IsolationDb = FailedBusinessCanaryProofDb & Pick<KeryxDB, "getA2aFailedOriginalFulfillment" | "hasA2aFailedOriginalFulfillment">;
export async function inspectFailedCanaryResearchIsolation(db: IsolationDb) {
  if (!db.getA2aFailedOriginalFulfillment || !db.hasA2aFailedOriginalFulfillment) return refuse();
  const before = evidence(retainedFailedBusinessCanaryAuthority());
  const failed = await verifyFailedBusinessCanary(db);
  const native = await db.getA2aFailedOriginalFulfillment(before.old.original.id);
  if (failed.originalEvidenceSha256 !== before.old.originalEvidenceSha256 || !native || native.completion !== null ||
    !same({ authority: native.claim.authority, claimId: native.claim.claimId, claimedAt: native.claim.claimedAt }, before.partial.claim) ||
    !same(native.claim.failedOrder, await db.getA2aOrder(before.old.original.id)) ||
    await db.hasA2aFailedOriginalFulfillment(before.partial.claim.authority)) refuse();
  if (!same(before, evidence(retainedFailedBusinessCanaryAuthority())) ||
    !same(native, await db.getA2aFailedOriginalFulfillment(before.old.original.id)) ||
    !same(failed, await verifyFailedBusinessCanary(db))) refuse();
  return { evidenceSha256: hash(before), newModelHolds: before.partial.providerLedger.newModelCalls,
    combinedReservedMicroUsd: before.partial.providerLedger.combinedReservedMicroUsd,
    originalDelivered: false as const, paidDeliveryObligation: "unresolved" as const };
}
function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Explicit private metadata operation; never exposed on a public route and
 * never issues a supplier capability, refund, payment or new order. */
export async function isolateFailedCanaryResearch(db: IsolationDb, expectedEvidenceSha256: string, flush = syncDirectory) {
  digest.parse(expectedEvidenceSha256);
  const proof = await inspectFailedCanaryResearchIsolation(db);
  if (proof.evidenceSha256 !== expectedEvidenceSha256) refuse();
  const existing = readMarker();
  if (existing) { if (existing.evidenceSha256 !== expectedEvidenceSha256) refuse(); return existing; }
  const directory = canaryResearchIsolationDirectory();
  fs.mkdirSync(directory, { mode: 0o700 }); protectedPath(directory, true);
  const marker = schema.parse({ format: "keryx-failed-canary-research-isolation-v1", recordedAt: new Date().toISOString(),
    evidenceSha256: expectedEvidenceSha256, originalDelivered: false, originalRefunded: false,
    paidDeliveryObligation: "unresolved", operatorAdmissionPaused: true, ordinaryResearchRestored: true, newSupplierAuthority: false });
  const pending = path.join(directory, "pending.json"), published = path.join(directory, "isolated.json");
  const fd = fs.openSync(pending, "wx", 0o600);
  try { fs.writeFileSync(fd, canonicalJson(marker) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  flush(directory); flush(path.dirname(directory));
  if ((await inspectFailedCanaryResearchIsolation(db)).evidenceSha256 !== expectedEvidenceSha256) refuse();
  fs.renameSync(pending, published);
  try { flush(directory); } catch (error) {
    // Retain the staged evidence without allowing research after an uncertain
    // publication. The directory remains invalid for all runtime readers.
    fs.renameSync(published, pending);
    try { syncDirectory(directory); } catch { /* Retain the pending file and the original refusal. */ }
    throw error;
  }
  if (!same(readMarker(), marker)) refuse();
  return marker;
}
