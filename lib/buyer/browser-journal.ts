import { z } from "zod";
import { browserTransaction } from "./browser-storage";
import { canonicalJson } from "../canonical-json";
import { a2aQueryIdSchema } from "../a2a/buyer-workspace";
import { buyerIntentEnvelopeSchema, type BuyerIntentEnvelope } from "./protocol";
import { verifyBrowserIntent } from "./browser-result";
import { validateSellerEvidence } from "./result-binding";
import { paymentAcknowledgementSchema as acknowledgementSchema, parseBuyerRecovery, encodeBuyerRecovery, type PaymentAcknowledgement } from "./recovery";

const DATABASE = "keryx-buyer-jobs-v1";
const STORE = "jobs";
const recordSchema = z.object({
  schema: z.literal("keryx-browser-job-v1"),
  queryId: a2aQueryIdSchema,
  intent: buyerIntentEnvelopeSchema,
  origin: z.enum(["created", "imported"]),
  submission: z.enum(["prepared", "submission_possible"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  acknowledgement: acknowledgementSchema.optional(),
}).strict().refine(row => row.queryId === row.intent.queryId, "Journal key mismatch");
export type BrowserJournal = z.infer<typeof recordSchema>;

const transaction = <T>(mode: IDBTransactionMode, work: Parameters<typeof browserTransaction<T>>[2]) =>
  browserTransaction<T>({ database: DATABASE, store: STORE, keyPath: "queryId", indexes: [{ name: "createdAt", keyPath: "createdAt" }] }, mode, work);

async function validateRecord(value: unknown): Promise<BrowserJournal> {
  const record = recordSchema.parse(value);
  await verifyBrowserIntent(record.intent);
  if (record.origin === "imported" && record.submission !== "submission_possible") throw new Error("Imported journal is recovery-only");
  if (record.acknowledgement && (record.submission !== "submission_possible"
    || (record.acknowledgement.evidence && !validateSellerEvidence(record.acknowledgement.evidence, record.intent)))) {
    throw new Error("Invalid saved payment acknowledgement");
  }
  return record;
}

async function insert(value: unknown, origin: BrowserJournal["origin"], acknowledgement?: PaymentAcknowledgement): Promise<BrowserJournal> {
  const intent = await verifyBrowserIntent(value);
  const now = new Date().toISOString();
  const record = await validateRecord({ schema: "keryx-browser-job-v1", queryId: intent.queryId,
    intent, origin, submission: origin === "created" ? "prepared" : "submission_possible", createdAt: now, updatedAt: now,
    ...(acknowledgement ? { acknowledgement } : {}) });
  await transaction<void>("readwrite", (store, done) => { store.add(record).onsuccess = () => done(undefined); });
  const saved = await readBrowserJournal(record.queryId);
  if (canonicalJson(saved) !== canonicalJson(record)) throw new Error("Buyer journal read-back mismatch");
  return saved;
}

/** Only a freshly generated purchase intent enters this path; insertion is exclusive. */
export const createBrowserJournal = (intent: BuyerIntentEnvelope) => insert(intent, "created");

/** An imported CLI/recovery file cannot acquire permission to submit, even if never paid. */
export async function importBrowserJournal(text: string): Promise<BrowserJournal> {
  const recovery = parseBuyerRecovery(text);
  return insert(recovery.intent, "imported", recovery.acknowledgement);
}

export async function readBrowserJournal(queryId: string): Promise<BrowserJournal> {
  a2aQueryIdSchema.parse(queryId);
  const record = await transaction<unknown>("readonly", (store, done) => {
    store.get(queryId).onsuccess = event => done((event.target as IDBRequest).result);
  });
  if (!record) throw new Error("Buyer journal not found");
  return validateRecord(record);
}

/** Atomic cross-tab gate. Once true, every reload and retry must use GET recovery only. */
export async function claimBrowserSubmission(value: BuyerIntentEnvelope): Promise<boolean> {
  const intent = await verifyBrowserIntent(value);
  const expected = canonicalJson(intent);
  return transaction<boolean>("readwrite", (store, done, fail) => {
    const request = store.get(intent.queryId);
    request.onsuccess = () => {
      try {
        const record = recordSchema.parse(request.result);
        if (canonicalJson(record.intent) !== expected) { fail(); return; }
        if (record.origin !== "created" || record.submission !== "prepared") { done(false); return; }
        store.put({ ...record, submission: "submission_possible", updatedAt: new Date().toISOString() }).onsuccess = () => done(true);
      } catch { fail(); }
    };
  });
}

export async function listBrowserJournals(): Promise<BrowserJournal[]> {
  const rows = await transaction<unknown[]>("readonly", (store, done) => {
    const collected: unknown[] = [];
    const request = store.index("createdAt").openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || collected.length === 50) { done(collected); return; }
      collected.push(cursor.value); cursor.continue();
    };
  });
  return Promise.all(rows.map(validateRecord));
}

/** Persist only allowlisted seller evidence, never raw payment headers or signature bytes. */
export async function saveBrowserAcknowledgement(intent: BuyerIntentEnvelope, value: z.input<typeof acknowledgementSchema>): Promise<void> {
  await verifyBrowserIntent(intent);
  const acknowledgement = acknowledgementSchema.parse(value);
  if (acknowledgement.evidence && !validateSellerEvidence(acknowledgement.evidence, intent)) throw new Error("Wrong payment acknowledgement");
  const expected = canonicalJson(intent);
  await transaction<void>("readwrite", (store, done, fail) => {
    const request = store.get(intent.queryId);
    request.onsuccess = () => {
      try {
        const record = recordSchema.parse(request.result);
        if (canonicalJson(record.intent) !== expected || record.submission !== "submission_possible"
          || record.origin !== "created") { fail(); return; }
        // A later empty/error response must not erase an earlier acknowledgement.
        if (record.acknowledgement) { fail(); return; }
        store.put({ ...record, acknowledgement, updatedAt: new Date().toISOString() }).onsuccess = () => done(undefined);
      } catch { fail(); }
    };
  });
}

export async function exportBrowserJournal(queryId: string): Promise<string> {
  const row = await readBrowserJournal(queryId);
  return encodeBuyerRecovery(row.intent, row.acknowledgement);
}

/** Local privacy control only: deleting a journal never cancels a job or authorization. */
export async function deleteBrowserJournal(queryId: string): Promise<void> {
  a2aQueryIdSchema.parse(queryId);
  await transaction<void>("readwrite", (store, done) => { store.delete(queryId).onsuccess = () => done(undefined); });
}
