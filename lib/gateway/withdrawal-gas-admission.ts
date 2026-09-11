import type { DatabaseSync } from "node:sqlite";
import { maxUint256 } from "viem";
import { z } from "zod";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { withdrawalTransferSpecHash } from "./withdrawal-attestation";
import { withdrawalMintTermsSchema } from "./withdrawal-mint-transaction";
import type { WithdrawalMintJournalPolicy } from "./withdrawal-mint-journal";

const ceilingSchema = z.string().regex(/^[1-9][0-9]{0,77}$/)
  .refine(value => BigInt(value) <= maxUint256);
type Admission = { request: WithdrawalRequestRecord; maxGasCostWei: string };
const stable = (value: unknown) => JSON.stringify(value);

/** Accounting uses the union of admissions and legacy slots. Attaching a nonce does
 * not consume a second ceiling or free the unused portion of the first ceiling. */
export function mintGasCommitments(db: DatabaseSync, policy: WithdrawalMintJournalPolicy) {
  const commitments = new Map<string, { specHash: string; amount: bigint; request: string }>();
  const specs = new Set<string>();
  const holds = db.prepare("SELECT * FROM mint_journal_admissions LIMIT ?").all(policy.maxSlots + 1);
  for (const row of holds) {
    const hold = JSON.parse(String(row.data)) as Admission;
    const amount = ceilingSchema.parse(hold.maxGasCostWei);
    if (hold.request.id !== row.id || amount !== row.max_gas_cost_wei
      || withdrawalTransferSpecHash(hold.request) !== row.spec_hash || specs.has(String(row.spec_hash)))
      throw new Error("Mint admission history unavailable");
    specs.add(String(row.spec_hash));
    commitments.set(String(row.id), { specHash: String(row.spec_hash), amount: BigInt(amount), request: stable(hold.request) });
  }
  const slots = db.prepare("SELECT * FROM mint_journal_slots ORDER BY nonce LIMIT ?").all(policy.maxSlots + 1);
  slots.forEach((row, index) => {
    const slot = JSON.parse(String(row.data));
    const terms = withdrawalMintTermsSchema.parse(slot.terms);
    const amount = BigInt(terms.gas) * BigInt(terms.maxFeePerGas);
    if (row.nonce !== policy.initialNonce + index || terms.nonce !== row.nonce || terms.relayer !== policy.relayer
      || slot.request.id !== row.id || slot.maxGasCostWei !== row.max_gas_cost_wei || amount.toString() !== row.max_gas_cost_wei
      || withdrawalTransferSpecHash(slot.request) !== row.spec_hash) throw new Error("Mint gas history unavailable");
    const hold = commitments.get(String(row.id));
    if (hold) {
      if (hold.specHash !== row.spec_hash || hold.request !== stable(slot.request) || amount > hold.amount)
        throw new Error("Mint admission conflict");
    } else {
      if (specs.has(String(row.spec_hash))) throw new Error("Mint admission conflict");
      specs.add(String(row.spec_hash));
      commitments.set(String(row.id), { specHash: String(row.spec_hash), amount, request: stable(slot.request) });
    }
  });
  if (commitments.size > policy.maxSlots) throw new Error("Mint admission capacity unavailable");
  const total = [...commitments.values()].reduce((sum, item) => sum + item.amount, BigInt(0));
  if (total > BigInt(policy.lifetimeGasBudgetWei)) throw new Error("Mint gas budget unavailable");
  return { commitments, total };
}

export function attachWithdrawalGasAdmission(db: DatabaseSync, policy: WithdrawalMintJournalPolicy,
  checkPolicy: () => void, atomic: <T>(operation: () => T) => T) {
  async function getGasAdmission(id: string): Promise<Admission | null> {
    checkPolicy();
    mintGasCommitments(db, policy);
    const row = db.prepare("SELECT * FROM mint_journal_admissions WHERE id=?").get(id);
    if (!row) return null;
    const original = JSON.parse(String(row.data)) as Admission;
    const request = await validateWithdrawalRequest(original.request);
    const checked = { request, maxGasCostWei: ceilingSchema.parse(original.maxGasCostWei) };
    if (request.id !== id || checked.maxGasCostWei !== row.max_gas_cost_wei
      || withdrawalTransferSpecHash(request) !== row.spec_hash || stable(checked) !== stable(original))
      throw new Error("Mint admission readback unavailable");
    return checked;
  }
  async function admitGas(value: WithdrawalRequestRecord, ceiling: string, signal: AbortSignal) {
    const copied = structuredClone(value), maxGasCostWei = ceilingSchema.parse(ceiling);
    const request = await validateWithdrawalRequest(copied);
    const admission = { request, maxGasCostWei }, specHash = withdrawalTransferSpecHash(request);
    signal.throwIfAborted();
    atomic(() => {
      const { commitments, total } = mintGasCommitments(db, policy), existing = commitments.get(request.id);
      if (existing) {
        if (existing.request !== stable(request) || existing.specHash !== specHash || existing.amount !== BigInt(maxGasCostWei))
          throw new Error("Mint admission conflict");
      } else if (commitments.size >= policy.maxSlots || [...commitments.values()].some(item => item.specHash === specHash)) {
        throw new Error("Mint admission capacity unavailable");
      } else if (total + BigInt(maxGasCostWei) > BigInt(policy.lifetimeGasBudgetWei)) {
        throw new Error("Mint gas budget unavailable");
      }
      db.prepare(`INSERT INTO mint_journal_admissions(id,spec_hash,max_gas_cost_wei,data) VALUES(?,?,?,?)
        ON CONFLICT(id) DO NOTHING`).run(request.id, specHash, maxGasCostWei, stable(admission));
    });
    const saved = await getGasAdmission(request.id);
    if (!saved || stable(saved) !== stable(admission)) throw new Error("Mint admission readback unavailable");
    return saved;
  }
  function gasAdmissionSummary() {
    checkPolicy();
    const { commitments, total } = mintGasCommitments(db, policy);
    const awaitingSlot = db.prepare(`SELECT count(*) n FROM mint_journal_admissions a
      LEFT JOIN mint_journal_slots s ON s.id=a.id WHERE s.id IS NULL`).get();
    return { committedRequests: commitments.size, awaitingSlot: Number(awaitingSlot?.n),
      committedGasWei: total.toString(), remainingGasBudgetWei: (BigInt(policy.lifetimeGasBudgetWei) - total).toString() };
  }
  function listGasAdmissionIds(afterId?: string, limit = 32) {
    checkPolicy(); mintGasCommitments(db, policy);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64
      || (afterId !== undefined && !/^0x[a-f0-9]{64}$/.test(afterId))) throw new Error("Mint admission page unavailable");
    const rows = db.prepare(`SELECT a.id FROM mint_journal_admissions a
      LEFT JOIN mint_journal_slots s ON s.id=a.id WHERE s.id IS NULL AND a.id>? ORDER BY a.id LIMIT ?`)
      .all(afterId ?? "", limit + 1);
    const ids = rows.slice(0, limit).map(row => String(row.id));
    return { ids, nextCursor: rows.length > limit ? ids.at(-1)! : null };
  }
  return { admitGas, getGasAdmission, gasAdmissionSummary, listGasAdmissionIds };
}
