import { z } from "zod";
import { browserTransaction } from "../buyer/browser-storage";
import { canonicalJson } from "../canonical-json";
import { validateWithdrawIntent, withdrawPolicySchema, withdrawRequestSchema, type WithdrawPolicy } from "./withdraw-protocol";
import { validateWithdrawalRequest, withdrawalIdSchema, withdrawalOwnerSchema, type WithdrawalRequestRecord } from "./withdrawal-request";
import { browserPaymentProfile } from "../browser-payment-profile";
import { assertWithdrawalNetworkPolicy } from "./withdrawal-network";
import type { OwnerWalletMintAttempt } from "./withdrawal-owner-wallet-mint";

const profile = browserPaymentProfile();
const spec = { database: profile.testnet ? "keryx-creator-withdrawals-v1" : "keryx-creator-withdrawals-v2-arc", store: "requests", keyPath: "id", indexes: [{ name: "owner", keyPath: "owner" }] };
const unsignedInteger = z.string().regex(/^(0|[1-9]\d{0,77})$/);
const mintSchema=z.object({to:withdrawalOwnerSchema,data:z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/).max(8194),value:z.literal("0"),
  nonce:z.number().int().nonnegative().safe(),gas:unsignedInteger,maxFeePerGas:unsignedInteger,maxPriorityFeePerGas:unsignedInteger,hash:withdrawalIdSchema.optional()}).strict();
const draftSchema = z.object({ id: withdrawalIdSchema, owner: withdrawalOwnerSchema, policy: withdrawPolicySchema,
  burnIntent: withdrawRequestSchema.shape.burnIntent }).strict();
const rowSchema = z.object({ format: z.literal("creator-withdrawal-browser-v1"), id: withdrawalIdSchema, owner: withdrawalOwnerSchema,
  draft: draftSchema, request: z.unknown().optional(), state: z.enum(["reserved", "signed", "submission-possible"]),
  mint: mintSchema.optional(),
  origin: z.enum(["created", "imported"]), createdAt: z.string().datetime() }).strict();
type Draft = z.infer<typeof draftSchema>;
type Row = Omit<z.infer<typeof rowSchema>, "request"> & { request?: WithdrawalRequestRecord };
const transaction = <T>(mode: IDBTransactionMode, work: Parameters<typeof browserTransaction<T>>[2]) => browserTransaction<T>(spec, mode, work);

export function createWithdrawalBrowserDraft(value: unknown, selected: WithdrawPolicy): Draft {
  const policy = withdrawPolicySchema.parse(selected), checked = validateWithdrawIntent(value, policy);
  assertWithdrawalNetworkPolicy(policy, profile);
  if (policy.domain !== 26) throw new Error("Withdrawal network unavailable");
  return { id: checked.id, owner: checked.owner, policy, burnIntent: checked.burnIntent };
}
async function validateRow(value: unknown, owner: string): Promise<Row> {
  const row = rowSchema.parse(value), wallet = withdrawalOwnerSchema.parse(owner);
  const draft = createWithdrawalBrowserDraft(row.draft.burnIntent, row.draft.policy);
  if (row.owner !== wallet || row.id !== draft.id || draft.owner !== wallet || canonicalJson(row.draft) !== canonicalJson(draft)
    || (row.origin === "imported" && row.state !== "submission-possible")) throw new Error("Withdrawal browser journal unavailable");
  if (row.state === "reserved") {
    if (row.request !== undefined || row.mint !== undefined) throw new Error("Withdrawal browser journal unavailable");
    return { ...row, draft, request: undefined };
  }
  const request = await validateWithdrawalRequest(row.request);
  if(request.network!==profile.networkId)throw new Error("Original withdrawal network differs");
  if(row.mint&&(profile.testnet||row.state!=="submission-possible"||row.mint.to!==profile.gatewayMinter.toLowerCase()||
    BigInt(row.mint.gas)<=BigInt(0)||BigInt(row.mint.maxFeePerGas)<=BigInt(0)||BigInt(row.mint.maxPriorityFeePerGas)>BigInt(row.mint.maxFeePerGas)))
    throw new Error("Original owner mint journal differs");
  if (canonicalJson(createWithdrawalBrowserDraft(request.request.burnIntent, request.policy)) !== canonicalJson(draft))
    throw new Error("Withdrawal signature changed the original draft");
  return { ...row, draft, request };
}
/** Persist owner gas terms before its wallet prompt. Never reset a possibly delivered mint. */
export async function claimWithdrawalBrowserOwnerMint(id:string,owner:string,attempt:OwnerWalletMintAttempt){
  const previous=await readWithdrawalBrowserJournal(id,owner),mint=mintSchema.parse(attempt);
  if(profile.testnet||!previous.request||previous.state!=="submission-possible"||previous.mint||mint.hash||
    mint.to!==profile.gatewayMinter.toLowerCase())return false;
  const next=await validateRow({...previous,mint},owner);
  return replace(previous,next);
}
export async function retainWithdrawalBrowserOwnerMintHash(id:string,owner:string,hash:string){
  const previous=await readWithdrawalBrowserJournal(id,owner),selected=withdrawalIdSchema.parse(hash);
  if(!previous.mint||previous.mint.hash&&previous.mint.hash!==selected)throw new Error("Original owner mint response differs");
  if(!await replace(previous,{...previous,mint:{...previous.mint,hash:selected}}))throw new Error("Original owner mint changed");
}
export async function readWithdrawalBrowserJournal(id: string, owner: string) {
  withdrawalIdSchema.parse(id);
  const value = await transaction<unknown>("readonly", (store, done) => {
    store.get(id).onsuccess = event => done((event.target as IDBRequest).result);
  });
  return validateRow(value, owner);
}
async function insert(value: unknown, owner: string) {
  const row = await validateRow(value, owner);
  await transaction<void>("readwrite", (store, done) => { store.add(row).onsuccess = () => done(undefined); });
  const saved = await readWithdrawalBrowserJournal(row.id, owner);
  if (canonicalJson(saved) !== canonicalJson(row)) throw new Error("Withdrawal journal readback unavailable");
  return saved;
}
/** Persist before asking the wallet to sign. A rejected prompt retains this draft. */
export async function reserveWithdrawalBrowserJournal(value: Draft, owner: string) {
  const draft = draftSchema.parse(value);
  return insert({ format: "creator-withdrawal-browser-v1", id: draft.id, owner: withdrawalOwnerSchema.parse(owner),
    draft, origin: "created", state: "reserved", createdAt: new Date().toISOString() }, owner);
}
async function replace(previous: Row, next: Row) {
  return transaction<boolean>("readwrite", (store, done, fail) => {
    const get = store.get(previous.id);
    get.onsuccess = () => {
      try {
        if (canonicalJson(get.result) !== canonicalJson(previous)) { done(false); return; }
        store.put(next).onsuccess = () => done(true);
      } catch { fail(); }
    };
  });
}
export async function saveWithdrawalBrowserSignature(value: WithdrawalRequestRecord, owner: string) {
  const request = await validateWithdrawalRequest(structuredClone(value));
  const previous = await readWithdrawalBrowserJournal(request.id, owner);
  if (previous.origin !== "created" || previous.state !== "reserved") throw new Error("Withdrawal is already signed or recovery-only");
  const next = await validateRow({ ...previous, request, state: "signed" }, owner);
  if (!await replace(previous, next)) throw new Error("Withdrawal journal changed while signing");
  const saved = await readWithdrawalBrowserJournal(request.id, owner);
  if (canonicalJson(saved) !== canonicalJson(next)) throw new Error("Withdrawal signature readback unavailable");
  return saved;
}
/** Only the caller whose strict IDB transaction commits may attempt submission. */
export async function claimWithdrawalBrowserSubmission(value: WithdrawalRequestRecord, owner: string) {
  const request = await validateWithdrawalRequest(structuredClone(value));
  const previous = await readWithdrawalBrowserJournal(request.id, owner);
  if (canonicalJson(previous.request) !== canonicalJson(request)) throw new Error("Withdrawal submission changed");
  if (previous.origin !== "created" || previous.state !== "signed") return false;
  return replace(previous, { ...previous, state: "submission-possible" });
}
/** Imported originals are always recovery-only. Missing local history is not retry permission. */
export async function importWithdrawalBrowserJournal(value: WithdrawalRequestRecord, owner: string) {
  const request = await validateWithdrawalRequest(structuredClone(value));
  return insert({ format: "creator-withdrawal-browser-v1", id: request.id, owner: request.owner,
    draft: createWithdrawalBrowserDraft(request.request.burnIntent, request.policy), request,
    origin: "imported", state: "submission-possible", createdAt: new Date().toISOString() }, owner);
}
export async function listWithdrawalBrowserJournals(owner: string, afterId?: string) {
  const wallet = withdrawalOwnerSchema.parse(owner);
  if (afterId !== undefined) withdrawalIdSchema.parse(afterId);
  const rows = await transaction<{ key: string; value: unknown }[]>("readonly", (store, done) => {
    const values: { key: string; value: unknown }[] = [], cursor = store.index("owner").openCursor(IDBKeyRange.only(wallet));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || values.length === 26) { done(values); return; }
      if (afterId === undefined || String(current.primaryKey) > afterId) values.push({ key: String(current.primaryKey), value: current.value });
      current.continue();
    };
  });
  const selected = rows.slice(0, 25);
  // Cursor authority is the IndexedDB primary key, never a possibly corrupted
  // payload's id. An unreadable row must not hide other originals or halt paging.
  for (const item of selected) withdrawalIdSchema.parse(item.key);
  const checked = await Promise.allSettled(selected.map(async item => {
    const row = await validateRow(item.value, wallet);
    if (row.id !== item.key) throw new Error("Withdrawal storage identity mismatch");
    return row;
  }));
  const requests = checked.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  return { requests, unavailableCount: checked.length - requests.length,
    nextCursor: rows.length > 25 ? selected.at(-1)!.key : null };
}
