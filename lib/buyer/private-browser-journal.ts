import { z } from "zod";
import { browserTransaction } from "./browser-storage";
import { canonicalJson } from "../canonical-json";
import { addressSchema } from "./protocol";
import { privateResearchIdSchema } from "../a2a/private-research-intent";
import { privateBrowserDraftSchema, validatePrivateBrowserDraft, privateDraftFromIntent } from "./private-browser-draft";
import { validatePrivateBuyerIntent, type PrivateBuyerIntent } from "./private-buyer-intent";
import type { PrivateMerchantPolicy } from "./private-merchant-policy";

const spec = { database: "keryx-private-buyer-jobs-v1", store: "jobs", keyPath: "id",
  indexes: [{ name: "payer", keyPath: "payer" }] };
const recordSchema = z.object({
  schema: z.literal("keryx-private-browser-job-v1"), id: privateResearchIdSchema,
  payer: addressSchema, draft: privateBrowserDraftSchema, intent: z.unknown().optional(),
  origin: z.enum(["created", "imported"]), state: z.enum(["reserved", "signed", "submission_possible"]),
  createdAt: z.string().datetime(),
}).strict();
export type PrivateBrowserJournal = Omit<z.infer<typeof recordSchema>, "intent"> & { intent?: PrivateBuyerIntent };
const transaction = <T>(mode: IDBTransactionMode, work: Parameters<typeof browserTransaction<T>>[2]) => browserTransaction<T>(spec, mode, work);

async function validateRecord(value: unknown, payer: string, merchants: PrivateMerchantPolicy): Promise<PrivateBrowserJournal> {
  const record = recordSchema.parse(value), owner = addressSchema.parse(payer).toLowerCase();
  const draft = await validatePrivateBrowserDraft(record.draft, owner, merchants);
  if (record.payer !== owner || record.id !== draft.id || (record.origin === "imported" && record.state !== "submission_possible"))
    throw new Error("Private browser journal mismatch");
  if (record.state === "reserved") {
    if (record.intent !== undefined) throw new Error("Reserved private job cannot contain a signature");
    return { ...record, draft, intent: undefined };
  }
  const intent = await validatePrivateBuyerIntent(record.intent, owner, merchants);
  if (canonicalJson(privateDraftFromIntent(intent)) !== canonicalJson(draft)) throw new Error("Private signature changed the reserved job");
  return { ...record, draft, intent };
}

export async function readPrivateBrowserJournal(id: string, payer: string, merchants: PrivateMerchantPolicy) {
  privateResearchIdSchema.parse(id);
  const value = await transaction<unknown>("readonly", (store, done) => { store.get(id).onsuccess = event => done((event.target as IDBRequest).result); });
  return validateRecord(value, payer, merchants);
}

/** Account-scoped local pagination, including reservations that never reached the server. */
export async function listPrivateBrowserJournals(payer: string, merchants: PrivateMerchantPolicy, after: string | null = null) {
  const owner = addressSchema.parse(payer).toLowerCase();
  if (after !== null) privateResearchIdSchema.parse(after);
  const rows = await transaction<unknown[]>("readonly", (store, done) => {
    const values: unknown[] = [];
    const request = store.index("payer").openCursor(IDBKeyRange.only(owner));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length === 26) { done(values); return; }
      if (after === null || String(cursor.primaryKey) > after) values.push(cursor.value);
      cursor.continue();
    };
  });
  const jobs = await Promise.all(rows.slice(0, 25).map(row => validateRecord(row, owner, merchants)));
  return { jobs, nextCursor: rows.length > 25 ? jobs[jobs.length - 1].id : null };
}

async function insert(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const record = await validateRecord(value, payer, merchants);
  await transaction<void>("readwrite", (store, done) => { store.add(record).onsuccess = () => done(undefined); });
  const saved = await readPrivateBrowserJournal(record.id, payer, merchants);
  if (canonicalJson(saved) !== canonicalJson(record)) throw new Error("Private browser journal read-back mismatch");
  return saved;
}

/** Must finish before signing. A rejected wallet prompt does not remove this reservation. */
export async function reservePrivateBrowserJournal(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const draft = await validatePrivateBrowserDraft(value, payer, merchants);
  return insert({ schema: "keryx-private-browser-job-v1", id: draft.id, payer: addressSchema.parse(payer).toLowerCase(),
    draft, origin: "created", state: "reserved", createdAt: new Date().toISOString() }, payer, merchants);
}

/** Compare the complete validated row again inside the committing transaction. */
async function replace(previous: PrivateBrowserJournal, next: PrivateBrowserJournal): Promise<boolean> {
  return transaction<boolean>("readwrite", (store, done, fail) => {
    const request = store.get(previous.id);
    request.onsuccess = () => {
      try {
        if (canonicalJson(request.result) !== canonicalJson(previous)) { done(false); return; }
        store.put(next).onsuccess = () => done(true);
      } catch { fail(); }
    };
  });
}

/** Store and read back the first signature. Never replace or refresh an authorization. */
export async function savePrivateBrowserSignature(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const intent = await validatePrivateBuyerIntent(value, payer, merchants);
  const previous = await readPrivateBrowserJournal(intent.id, payer, merchants);
  if (previous.origin !== "created" || previous.state !== "reserved") throw new Error("Private job is already signed or recovery-only");
  const next = await validateRecord({ ...previous, intent, state: "signed" }, payer, merchants);
  if (!await replace(previous, next)) throw new Error("Private job changed while saving its signature");
  const saved = await readPrivateBrowserJournal(intent.id, payer, merchants);
  if (canonicalJson(saved) !== canonicalJson(next)) throw new Error("Private signature read-back mismatch");
  return saved;
}

/** Atomic across tabs. A completed claim permits one caller to attempt POST, never a retry. */
export async function claimPrivateBrowserSubmission(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const intent = await validatePrivateBuyerIntent(value, payer, merchants);
  const previous = await readPrivateBrowserJournal(intent.id, payer, merchants);
  if (canonicalJson(previous.intent) !== canonicalJson(intent)) throw new Error("Private submission does not match its journal");
  if (previous.origin !== "created" || previous.state !== "signed") return false;
  return replace(previous, { ...previous, state: "submission_possible" });
}

/** Imported CLI/browser intents are permanently recovery-only, even if never submitted. */
export async function importPrivateBrowserJournal(value: unknown, payer: string, merchants: PrivateMerchantPolicy) {
  const intent = await validatePrivateBuyerIntent(value, payer, merchants);
  return insert({ schema: "keryx-private-browser-job-v1", id: intent.id, payer: addressSchema.parse(payer).toLowerCase(),
    draft: privateDraftFromIntent(intent), intent, origin: "imported", state: "submission_possible", createdAt: new Date().toISOString() }, payer, merchants);
}

/** Plaintext export contains the question, salt and bearer signature. Never auto-download. */
export async function exportPrivateBrowserJournal(id: string, payer: string, merchants: PrivateMerchantPolicy) {
  const record = await readPrivateBrowserJournal(id, payer, merchants);
  if (!record.intent) throw new Error("Private signing did not complete; retain the local reservation");
  return JSON.stringify(record.intent);
}
