import type { DatabaseSync } from "node:sqlite";
import { assertMintJournalSchema, initializeMintJournalSchema } from "./withdrawal-journal-schema";
import { attachWithdrawalObservations } from "./withdrawal-journal-observations";
import { attachWithdrawalGasAdmission, mintGasCommitments } from "./withdrawal-gas-admission";
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
    mintGasCommitments(db, policy);
    const row = db.prepare("SELECT * FROM mint_journal_slots WHERE id=?").get(id);
    if (!row) return null;
    const checked = await validateSlot(JSON.parse(String(row.data)));
    if (checked.request.id !== id || checked.terms.nonce !== row.nonce
      || checked.maxGasCostWei !== row.max_gas_cost_wei || checked.attestation.transferId !== row.transfer_id
      || checked.attestation.transferSpecHash !== row.spec_hash) throw new Error("Mint slot unavailable");
    return checked;
  }
  async function reserve(request: WithdrawalRequestRecord, response: unknown, selectedTerms: WithdrawalMintTerms, signal?: AbortSignal) {
    const copied = structuredClone({ request, response });
    const terms = withdrawalMintTermsSchema.parse(selectedTerms);
    const verified = await validateWithdrawalRequest(copied.request);
    const attestation = await matchWithdrawalAttestation(verified, copied.response);
    const slot: Slot = { request: verified, attestation, terms,
      maxGasCostWei: (BigInt(terms.gas) * BigInt(terms.maxFeePerGas)).toString() };
    if (terms.relayer !== policy.relayer) throw new Error("Mint relayer unavailable");
    signal?.throwIfAborted();
    atomic(() => {
      const existing = db.prepare("SELECT data FROM mint_journal_slots WHERE id=?").get(verified.id);
      if (existing) {
        if (existing.data !== stable(slot)) throw new Error("Mint slot conflict");
        return;
      }
      const rows = db.prepare("SELECT nonce FROM mint_journal_slots ORDER BY nonce").all();
      if (rows.length >= policy.maxSlots || terms.nonce !== policy.initialNonce + rows.length)
        throw new Error("Mint nonce unavailable");
      const { commitments, total } = mintGasCommitments(db, policy);
      const held = commitments.get(verified.id);
      if (held && (held.request !== stable(verified) || held.specHash !== attestation.transferSpecHash
        || BigInt(slot.maxGasCostWei) > held.amount)) throw new Error("Mint admission conflict");
      if (!held && (commitments.size >= policy.maxSlots
        || [...commitments.values()].some(item => item.specHash === attestation.transferSpecHash)))
        throw new Error("Mint admission capacity unavailable");
      if (!held && total + BigInt(slot.maxGasCostWei) > BigInt(policy.lifetimeGasBudgetWei))
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
  const admission = attachWithdrawalGasAdmission(db, policy, checkPolicy, atomic);
  const observations = attachWithdrawalObservations(db, core, checkPolicy, atomic);
  async function gasBackingSnapshot() {
    checkPolicy();
    const { commitments, total } = mintGasCommitments(db, policy);
    let outstanding = total, minimumBlock = BigInt(0);
    for (const id of listRequestIds()) {
      const observed = await observations.getObserved(id);
      if (!observed) continue;
      const committed = commitments.get(id);
      if (!committed) throw new Error("Mint backing history unavailable");
      // This original nonce was observed finalized. Its lifetime budget stays
      // charged, but no further gas is needed to execute that same transaction.
      outstanding -= committed.amount;
      if (BigInt(observed.blockNumber) > minimumBlock) minimumBlock = BigInt(observed.blockNumber);
    }
    const current = mintGasCommitments(db, policy);
    if (current.total !== total || current.commitments.size !== commitments.size || outstanding < BigInt(0))
      throw new Error("Mint backing snapshot changed");
    return { relayer: policy.relayer, committedRequests: commitments.size, committedGasWei: total.toString(),
      outstandingGasWei: outstanding.toString(), minimumBlockNumber: minimumBlock.toString() };
  }
  async function reserveAdmitted(id: string, response: unknown, selectedTerms: Omit<WithdrawalMintTerms, "nonce">, signal: AbortSignal) {
    const copied = structuredClone(response);
    const terms = withdrawalMintTermsSchema.parse({ ...selectedTerms, nonce: 0 });
    const held = await admission.getGasAdmission(id);
    if (!held) throw new Error("Mint gas admission unavailable");
    const attestation = await matchWithdrawalAttestation(held.request, copied);
    const existing = await getSlot(id);
    signal.throwIfAborted();
    if (existing) {
      if (stable(existing.request) !== stable(held.request) || stable(existing.attestation) !== stable(attestation))
        throw new Error("Mint admission conflict");
      return existing;
    }
    // reserve atomically checks the nonce again. A competing assignment may reject
    // this call, but cannot consume another nonce or alter an original slot.
    terms.nonce = policy.initialNonce + listRequestIds().length;
    return reserve(held.request, attestation, terms, signal);
  }
  return { ...core, ...admission, reserveAdmitted, gasBackingSnapshot, ...observations };
}
