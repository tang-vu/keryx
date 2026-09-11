import type { DatabaseSync } from "node:sqlite";
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
const schema = `
CREATE TABLE IF NOT EXISTS mint_journal_policy(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mint_journal_slots(
  id TEXT PRIMARY KEY, nonce INTEGER NOT NULL UNIQUE, max_gas_cost_wei TEXT NOT NULL,
  transfer_id TEXT NOT NULL UNIQUE, spec_hash TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL CHECK(length(data)<=16384)
);
CREATE TABLE IF NOT EXISTS mint_journal_prepared(
  id TEXT PRIMARY KEY REFERENCES mint_journal_slots(id),
  transaction_hash TEXT NOT NULL UNIQUE, raw TEXT NOT NULL CHECK(length(raw)<=4098)
);
`;
const stable = (value: unknown) => JSON.stringify(value);

/** Private single-relayer signing journal, separate from the application database.
 * All instances controlling this key must share this exact journal. Constructor
 * policy is operator-owned; HTTP clients must never initialize it. No network or
 * key operation exists here. Missing/corrupt journal state must never be recreated
 * automatically for a previously used key. */
export function createWithdrawalMintJournal(db: DatabaseSync, selected: WithdrawalMintJournalPolicy,
  options: { initialize?: boolean } = {}) {
  const policy = policySchema.parse(selected);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
  if (options.initialize) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length === 0) {
        db.exec(schema);
        for (const table of ["mint_journal_policy", "mint_journal_slots", "mint_journal_prepared"]) {
          db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
            BEGIN SELECT RAISE(ABORT,'Mint journal is immutable'); END;
            CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
            BEGIN SELECT RAISE(ABORT,'Mint journal is immutable'); END;`);
        }
        db.prepare("INSERT INTO mint_journal_policy(id,data) VALUES(1,?)").run(stable(policy));
      } else if (tables.length !== 3 || !["mint_journal_policy", "mint_journal_slots", "mint_journal_prepared"]
        .every(name => tables.some(row => row.name === name))) throw new Error("Mint journal initialization unavailable");
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const checkPolicy = () => {
    for (const table of ["mint_journal_policy", "mint_journal_slots", "mint_journal_prepared"]) {
      const objects = db.prepare("SELECT name,type FROM sqlite_master WHERE name IN (?,?,?)")
        .all(table, `${table}_no_update`, `${table}_no_delete`);
      if (!objects.some(row => row.name === table && row.type === "table")
        || objects.filter(row => row.type === "trigger").length !== 2)
        throw new Error("Mint journal structure unavailable");
    }
    const row = db.prepare("SELECT data FROM mint_journal_policy WHERE id=1").get();
    if (row?.data !== stable(policy)) throw new Error("Mint journal policy unavailable");
  };
  checkPolicy();
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
  return { reserve, getSlot, savePrepared, getPrepared, listRequestIds };
}
