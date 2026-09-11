import type { DatabaseSync } from "node:sqlite";
import { assertMintJournalSchema, initializeMintJournalSchema } from "./withdrawal-journal-schema";
import { attachWithdrawalObservations } from "./withdrawal-journal-observations";
import { z } from "zod";
import { maxUint256, zeroAddress, type Hex } from "viem";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { matchWithdrawalMintTransaction, withdrawalMintTermsSchema, type WithdrawalMintTerms } from "./withdrawal-mint-transaction";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
  .pipe(z.string().refine(value => BigInt(value) <= maxUint256));
const policySchema = z.object({ format: z.literal("creator-mint-journal-v1"), chainId: z.literal(5042002),
  relayer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex)
    .refine(value => value !== zeroAddress),
  initialNonce: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lifetimeGasBudgetWei: uint.refine(value => BigInt(value) > BigInt(0)),
  maxSlots: z.number().int().min(1).max(1000),
}).strict();
export type WithdrawalMintJournalPolicy = z.infer<typeof policySchema>;
type Slot = { request: WithdrawalRequestRecord; attestation: Awaited<ReturnType<typeof matchWithdrawalAttestation>>;
  terms: WithdrawalMintTerms; maxGasCostWei: string };
const stable = (value: unknown) => JSON.stringify(value);

/** Private single-relayer signing journal, separate from the application database.
 * All instances controlling this key must share this exact journal. Constructor
 * policy is operator-owned; HTTP clients must never initialize it. Reconciliation
 * invokes a server-owned read-only observer; no key or broadcast operation exists
 * here. Missing/corrupt journal state must never be recreated
 * automatically for a previously used key. */
export function createWithdrawalMintJournal(db: DatabaseSync, selected: WithdrawalMintJournalPolicy,
  options: { initialize?: boolean; upgrade?: boolean } = {}) {
  const policy = policySchema.parse(selected);
  initializeMintJournalSchema(db, stable(policy), options);
  const checkPolicy = () => assertMintJournalSchema(db, stable(policy));
  const atomic = <T>(action: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try { checkPolicy(); const result = action(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  async function validateSlot(value: unknown): Promise<Slot> {
    try {
      const copied = structuredClone(value) as Slot;
      const terms = withdrawalMintTermsSchema.parse(copied.terms);
      const request = await validateWithdrawalRequest(copied.request);
      const attestation = await matchWithdrawalAttestation(request, copied.attestation);
      const checked = { request, attestation, terms,
        maxGasCostWei: (BigInt(terms.gas) * BigInt(terms.maxFeePerGas)).toString() };
      if (terms.relayer !== policy.relayer || stable(copied) !== stable(checked)) throw new Error();
      return checked;
    } catch { throw new Error("Mint slot unavailable"); }
  }
  async function getSlot(id: string): Promise<Slot | null> {
    checkPolicy();
    const row = db.prepare("SELECT * FROM mint_journal_slots WHERE id=?").get(id);
    if (!row) return null;
    const checked = await validateSlot(JSON.parse(String(row.data)));
    if (checked.request.id !== id || checked.terms.nonce !== row.nonce
      || checked.maxGasCostWei !== row.max_gas_cost_wei || checked.attestation.transferId !== row.transfer_id
      || checked.attestation.transferSpecHash !== row.spec_hash) throw new Error("Mint slot unavailable");
    return checked;
  }
  async function reserve(request: WithdrawalRequestRecord, response: unknown, selectedTerms: WithdrawalMintTerms) {
    const copied = structuredClone({ request, response });
    const terms = withdrawalMintTermsSchema.parse(selectedTerms);
    const verified = await validateWithdrawalRequest(copied.request);
    const attestation = await matchWithdrawalAttestation(verified, copied.response);
    const slot: Slot = { request: verified, attestation, terms,
      maxGasCostWei: (BigInt(terms.gas) * BigInt(terms.maxFeePerGas)).toString() };
    if (terms.relayer !== policy.relayer) throw new Error("Mint relayer unavailable");
    atomic(() => {
      const existing = db.prepare("SELECT data FROM mint_journal_slots WHERE id=?").get(verified.id);
      if (existing) {
        if (existing.data !== stable(slot)) throw new Error("Mint slot conflict");
        return;
      }
      const rows = db.prepare("SELECT nonce,max_gas_cost_wei,data FROM mint_journal_slots ORDER BY nonce").all();
      if (rows.length >= policy.maxSlots || terms.nonce !== policy.initialNonce + rows.length)
        throw new Error("Mint nonce unavailable");
      let committed = BigInt(0);
      rows.forEach((row, index) => {
        if (row.nonce !== policy.initialNonce + index) throw new Error("Mint nonce history unavailable");
        const original = JSON.parse(String(row.data)) as Slot;
        const priorTerms = withdrawalMintTermsSchema.parse(original.terms);
        if (priorTerms.relayer !== policy.relayer || priorTerms.nonce !== row.nonce
          || original.maxGasCostWei !== row.max_gas_cost_wei
          || (BigInt(priorTerms.gas) * BigInt(priorTerms.maxFeePerGas)).toString() !== row.max_gas_cost_wei)
          throw new Error("Mint gas history unavailable");
        committed += BigInt(uint.parse(row.max_gas_cost_wei));
      });
      if (committed + BigInt(slot.maxGasCostWei) > BigInt(policy.lifetimeGasBudgetWei))
        throw new Error("Mint gas budget unavailable");
      db.prepare(`INSERT INTO mint_journal_slots(id,nonce,max_gas_cost_wei,transfer_id,spec_hash,data)
        VALUES(?,?,?,?,?,?)`).run(verified.id, terms.nonce, slot.maxGasCostWei,
        attestation.transferId, attestation.transferSpecHash, stable(slot));
    });
    const saved = await getSlot(verified.id);
    if (!saved || stable(saved) !== stable(slot)) throw new Error("Mint slot readback unavailable");
    return saved;
  }
  async function getPrepared(id: string) {
    const slot = await getSlot(id);
    if (!slot) return null;
    const row = db.prepare("SELECT transaction_hash,raw FROM mint_journal_prepared WHERE id=?").get(id);
    if (!row) return null;
    const checked = await matchWithdrawalMintTransaction(slot.request, slot.attestation, row.raw, slot.terms);
    if (checked.transactionHash !== row.transaction_hash) throw new Error("Mint transaction readback unavailable");
    return checked;
  }
  async function savePrepared(id: string, raw: string) {
    const slot = await getSlot(id);
    if (!slot) throw new Error("Mint slot unavailable");
    const checked = await matchWithdrawalMintTransaction(slot.request, slot.attestation, raw, slot.terms);
    atomic(() => {
      db.prepare(`INSERT INTO mint_journal_prepared(id,transaction_hash,raw) VALUES(?,?,?)
        ON CONFLICT(id) DO NOTHING`).run(id, checked.transactionHash, checked.serializedTransaction);
    });
    // Broadcast callers must use only this durably read-back original, never raw.
    const saved = await getPrepared(id);
    if (!saved || saved.transactionHash !== checked.transactionHash) throw new Error("Mint transaction conflict");
    return saved;
  }
  function listRequestIds() {
    checkPolicy();
    const rows = db.prepare("SELECT id,nonce FROM mint_journal_slots ORDER BY nonce LIMIT ?").all(policy.maxSlots + 1);
    if (rows.length > policy.maxSlots || rows.some((row, index) => row.nonce !== policy.initialNonce + index))
      throw new Error("Mint nonce history unavailable");
    return rows.map(row => String(row.id));
  }
  const core = { reserve, getSlot, savePrepared, getPrepared, listRequestIds };
  return { ...core, ...attachWithdrawalObservations(db, core, checkPolicy, atomic) };
}
