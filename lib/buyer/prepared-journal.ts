import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { buyerIntentSchema, readBuyerJournal, writeBuyerFile, type BuyerIntent } from "./journal";
import { BuyerRefusal } from "./protocol";

const preparationSchema = z.object({
  schema: z.literal("keryx-buyer-preparation-v1"),
  queryId: z.string().min(1).max(128),
  intentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  maxTotalMicros: z.string().regex(/^[1-9]\d{0,6}$/).refine((v) => BigInt(v) <= BigInt(1_000_000)),
  createdAt: z.string().datetime(),
}).strict();

export function buyerIntentDigest(intent: BuyerIntent): string {
  return `sha256:${createHash("sha256").update(canonicalJson(buyerIntentSchema.parse(intent))).digest("hex")}`;
}

/** A detached frozen snapshot keeps a trusted admission/sign callback from changing the dispatch. */
export function immutableBuyerIntent(intent: BuyerIntent): BuyerIntent {
  const snapshot = buyerIntentSchema.parse(intent);
  Object.freeze(snapshot.request);
  Object.freeze(snapshot.requirement.extra);
  Object.freeze(snapshot.requirement);
  Object.freeze(snapshot.authorization);
  return Object.freeze(snapshot);
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function readRecord(directory: string, name: string) {
  const file = await open(join(directory, name), "r");
  try {
    if (!(await file.stat()).isFile()) throw new BuyerRefusal("SKIP: preparation record must be a regular file");
    const buffer = Buffer.alloc(8193);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 8192) throw new BuyerRefusal("SKIP: preparation record exceeds its size limit");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}

export async function recordBuyerPreparation(directory: string, intent: BuyerIntent, maxTotalMicros: string) {
  const record = preparationSchema.parse({ schema: "keryx-buyer-preparation-v1", queryId: intent.queryId,
    intentDigest: buyerIntentDigest(intent), maxTotalMicros, createdAt: new Date().toISOString() });
  await writeBuyerFile(directory, "prepared.json", record);
  return readPreparedBuyerJournal(directory, record.intentDigest);
}

/** Imports and old journals remain recovery-only; no missing/partial file is repaired to enable payment. */
export async function readPreparedBuyerJournal(directory: string, expectedIntentDigest?: string) {
  if (await exists(join(directory, "recovery-import.json"))) throw new BuyerRefusal("SKIP: imported journals are recovery-only");
  const intent = await readBuyerJournal(directory);
  const preparation = preparationSchema.parse(await readRecord(directory, "prepared.json"));
  const intentDigest = buyerIntentDigest(intent);
  if (preparation.queryId !== intent.queryId || preparation.intentDigest !== intentDigest
    || (expectedIntentDigest !== undefined && expectedIntentDigest !== intentDigest)
    || BigInt(intent.requirement.amount) > BigInt(preparation.maxTotalMicros)
    || BigInt(intent.requirement.amount) <= BigInt(Math.round(intent.request.budget * 1e6))) {
    throw new BuyerRefusal("SKIP: original prepared intent or price limit changed");
  }
  return { intent: immutableBuyerIntent(intent), intentDigest, maxTotalMicros: preparation.maxTotalMicros };
}

export async function assertBuyerSubmissionAvailable(directory: string) {
  if (await exists(join(directory, "submission.json"))) {
    throw new BuyerRefusal("SKIP: this original already claimed its one submission attempt; use GET-only resume");
  }
}

/** Exclusive creation is the process/crash boundary, before any signing callback or bearer exposure. */
export async function claimBuyerSubmission(directory: string, intent: BuyerIntent, intentDigest: string) {
  const attempt = { state: "submission_possible", at: new Date().toISOString(), queryId: intent.queryId, intentDigest };
  await writeBuyerFile(directory, "submission.json", attempt);
  if (canonicalJson(await readRecord(directory, "submission.json")) !== canonicalJson(attempt)) {
    throw new BuyerRefusal("SKIP: submission-attempt readback changed; retain this journal and resume");
  }
  // An interrupted or failed read leaves the exclusive attempt intact and cannot reopen signing.
  return readPreparedBuyerJournal(directory, intentDigest);
}

/** Circle batching needs at least seven days remaining; never refresh the original nonce or window. */
export function assertPreparedAuthorizationCurrent(intent: BuyerIntent, now = Date.now()) {
  const current = BigInt(Math.floor(now / 1000));
  const after = BigInt(intent.authorization.validAfter), before = BigInt(intent.authorization.validBefore);
  if (after >= current || before < current + BigInt(604_800)
    || before - after !== BigInt(intent.requirement.maxTimeoutSeconds) + BigInt(600)) {
    throw new BuyerRefusal("SKIP: original authorization is not currently eligible; keep the journal for review");
  }
}
