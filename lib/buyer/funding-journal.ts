import { browserTransaction, type BrowserStore } from "./browser-storage";
import { addressSchema, BUYER_NETWORK } from "./protocol";
import { fundingAmountSchema, fundingRecordSchema, transactionHashSchema, type FundingRecord, type FundingStep } from "./funding-policy";

const spec: BrowserStore = { database: "keryx-gateway-funding-v1", store: "funding", keyPath: "id", indexes: [
  { name: "activePayer", keyPath: "activePayer", unique: true }, { name: "payer", keyPath: "payer" }, { name: "createdAt", keyPath: "createdAt" },
] };
const transact = <T>(mode: IDBTransactionMode, work: Parameters<typeof browserTransaction<T>>[2]) => browserTransaction<T>(spec, mode, work);

export async function createFundingRecord(payer: string, amount: string): Promise<FundingRecord> {
  payer = addressSchema.parse(payer).toLowerCase(); fundingAmountSchema.parse(amount);
  const now = new Date().toISOString();
  const record = fundingRecordSchema.parse({ schema: "keryx-gateway-funding-v1", id: crypto.randomUUID(), payer, activePayer: payer,
    network: BUYER_NETWORK, amount, approval: { status: "ready" }, deposit: { status: "ready" }, createdAt: now, updatedAt: now });
  // The unique activePayer index serializes new deposits across tabs, including ready prompts.
  await transact<void>("readwrite", (store, done) => { store.add(record).onsuccess = () => done(undefined); });
  const saved = await readFundingRecord(record.id);
  if (JSON.stringify(saved) !== JSON.stringify(record)) throw new Error("Funding journal read-back mismatch");
  return saved;
}

export async function readFundingRecord(id: string): Promise<FundingRecord> {
  const value = await transact<unknown>("readonly", (store, done) => { store.get(id).onsuccess = event => done((event.target as IDBRequest).result); });
  return fundingRecordSchema.parse(value);
}

export async function listFundingRecords(payer: string): Promise<FundingRecord[]> {
  payer = addressSchema.parse(payer).toLowerCase();
  const values = await transact<unknown[]>("readonly", (store, done) => {
    store.index("payer").getAll(payer).onsuccess = event => done((event.target as IDBRequest).result);
  });
  return values.map(value => fundingRecordSchema.parse(value)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function change(id: string, update: (record: FundingRecord) => FundingRecord | null): Promise<boolean> {
  return transact<boolean>("readwrite", (store, done, fail) => {
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const next = update(fundingRecordSchema.parse(request.result));
        if (!next) { done(false); return; }
        const row = fundingRecordSchema.parse({ ...next, updatedAt: new Date().toISOString() });
        store.put(row).onsuccess = () => done(true);
      } catch { fail(); }
    };
  });
}

export const claimFundingStep = (id: string, step: FundingStep, nonce: number, beforeBlock: string) => change(id, row => {
  if (!row.activePayer || !["ready", "rejected"].includes(row[step].status) || (step === "deposit" && row.approval.status !== "confirmed")) return null;
  return { ...row, [step]: { status: "possible", nonce, beforeBlock } };
});

export async function saveFundingHash(id: string, step: FundingStep, hash: string) {
  transactionHashSchema.parse(hash);
  const changed = await change(id, row => row[step].status === "possible" ? { ...row, [step]: { ...row[step], status: "submitted", hash } } : null);
  if (!changed) throw new Error("Funding hash could not be attached to this attempt");
}

/** Only a definitive wallet-reported user rejection can reopen the prompt. Other errors stay possible. */
export const rejectFundingPrompt = (id: string, step: FundingStep) => change(id, row =>
  row[step].status === "possible" ? { ...row, [step]: { status: "rejected" } } : null);

export async function confirmFundingStep(id: string, step: FundingStep, hash: string, status: "confirmed" | "reverted") {
  const changed = await change(id, row => {
    if (row[step].status !== "submitted" || row[step].hash?.toLowerCase() !== hash.toLowerCase()) return null;
    const next = { ...row, [step]: { ...row[step], status, hash } };
    if (status === "reverted" || step === "deposit") delete next.activePayer;
    return next;
  });
  if (!changed) throw new Error("Funding confirmation no longer matches the active attempt");
}

export const cancelFundingRecord = (id: string) => change(id, row => {
  if (!row.activePayer || !["ready", "rejected"].includes(row.deposit.status) || !["ready", "rejected", "confirmed"].includes(row.approval.status)) return null;
  const next = { ...row, cancelled: true }; delete next.activePayer; return next;
});
