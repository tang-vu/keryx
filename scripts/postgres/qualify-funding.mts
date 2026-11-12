/** Differential synthetic oracle: current SQLite accounting versus native PG.
 * Retained rows are not new payments; every fixture remains inside the harness. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { installMainnetApplicationSchema } from "../../lib/db/mainnet-application-schema";
import { sqliteSessionFundingAccounting } from "../../lib/db/session-funding-accounting";
import { sqliteJournalTransaction } from "../../lib/db/sqlite-browser-journal";
import { ARC_MAINNET_PROFILE } from "../../lib/arc-network-profile";
import type { PostgresSessionTransport } from "../../lib/db/postgres/session-transport";

type Row = Record<string, string | number | null>;
interface Original { intent: Row; binding?: Row; payment?: Row }
const baseline = "2026-11-12T00:00:00.000Z";
function original(signer: string, amount: number, settled: boolean, createdAt = "2026-11-12T00:00:01.000Z"): Original {
  const nonce = `0x${randomBytes(32).toString("hex")}`, epoch = randomUUID(), payee = `0x${"88".repeat(20)}`, queryId=randomUUID();
  return {
    intent: { nonce, session_id: randomUUID(), request_id: randomUUID(), query_id: queryId, grant_epoch: epoch,
      signer, network: ARC_MAINNET_PROFILE.networkId, token: ARC_MAINNET_PROFILE.usdcAddress.toLowerCase(),
      gateway_contract: ARC_MAINNET_PROFILE.gatewayWallet.toLowerCase(), source_id: "synthetic-source", kind: "fetch", payee,
      amount_micro_usdc: amount, phase: "prepared", created_at: createdAt },
    binding: { nonce, requirements: "{}", payment_metadata: "{}" },
    payment: { id: `x402:${nonce}`, created_at: "2026-11-12T00:00:02.000Z", kind: "fetch", query_id:queryId,source_id:'synthetic-source',payer: signer, payee,
      amount_usdc: amount / 1e6, network: ARC_MAINNET_PROFILE.networkId, settled: settled ? 1 : 0,
      settlement_status: settled ? "settled" : "pending", authorization_phase: settled ? "settled" : "submission_attempted",
      authorization_id: nonce, grant_epoch: epoch, tx_hash: settled ? "synthetic-observed-transaction" : null },
  };
}
export async function qualifyFunding(input: { transport: PostgresSessionTransport; ownerSql: (text: string) => string;applicationTableReference?:boolean }) {
  const db = new DatabaseSync(":memory:");
  const q = (value: string | number | null): string => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
  const insert = (table: string, row: Row) => {
    const columns = Object.keys(row);
    assert(columns.every(key => /^[a-z_]+$/.test(key)) && /^[a-z_]+$/.test(table));
    db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map(key => row[key]));
    return `INSERT INTO public.${table}(${columns.join(",")}) VALUES(${columns.map(key => table==='payment_events'&&key==='settled'&&input.applicationTableReference?(row[key]===1?'true':'false'):q(row[key])).join(",")});`;
  };
  let vectors = 0, sourceImportRefusals=0;
  try {
    db.exec("BEGIN"); installMainnetApplicationSchema(db); db.exec("COMMIT");
    db.exec("UPDATE browser_journal_control SET active=1 WHERE id=1");
    const run = async (label: string, make: (signer: string) => { retained?: number; originals?: Original[]; extra?: Row[] }) => {
      const signer = `0x${randomBytes(20).toString("hex")}`, vector = make(signer);
      let sql = "UPDATE keryx_storage.control SET mode='held';";
      sqliteJournalTransaction(db, () => {
        if (vector.retained !== undefined) sql += insert("browser_signer_capacity", { signer, spent_micro: vector.retained });
        for (const o of vector.originals ?? []) {
          sql += insert("browser_authorization_intents", o.intent);
          if (o.binding) sql += insert("browser_journal_bindings", o.binding);
          if (o.payment) sql += insert("payment_events", o.payment);
        }
        for (const payment of vector.extra ?? []) sql += insert("payment_events", payment);
      });
      sql += "UPDATE keryx_storage.control SET mode='active';";
      if(input.applicationTableReference && label==='foreign original rail'){
        assert.throws(()=>input.ownerSql('BEGIN;'+sql+'COMMIT;'));
        assert.equal(input.ownerSql("SELECT mode FROM keryx_storage.control WHERE singleton;"),'active');
        assert.equal(input.ownerSql(`SELECT count(*) FROM public.browser_authorization_intents WHERE signer='${signer}';`),'0');
        for(const after of [undefined,baseline]){assert.throws(()=>sqliteSessionFundingAccounting(db,signer,after));sourceImportRefusals++;}
        return;
      }
      input.ownerSql('BEGIN;'+sql+'COMMIT;');
      for (const after of [undefined, baseline]) {
        let expected: ReturnType<typeof sqliteSessionFundingAccounting> | undefined;
        try { expected = sqliteSessionFundingAccounting(db, signer, after); } catch {}
        const native = input.transport.sessionFundingAccounting(signer, after);
        if (expected === undefined) await assert.rejects(native, () => true, label);
        else assert.deepEqual(await native, expected, label);
        vectors++;
      }
      assert.equal(await input.transport.browserSignerRetainedSpend(signer.toUpperCase().replace("0X", "0x")), vector.retained ?? 0);
    };
    await run("empty history", () => ({}));
    await run("retained pending debit earns no credit", s => ({ retained: 7, originals: [original(s, 7, false)] }));
    await run("exact settled original", s => ({ retained: 7, originals: [original(s, 7, true)] }));
    await run("late pre-baseline confirmation is not new-deposit credit", s => ({ retained: 7, originals: [original(s, 3, true, "2026-11-11T23:59:59.000Z"), original(s, 4, true)] }));
    await run("missing retained capacity", s => ({ originals: [original(s, 7, true)] }));
    await run("missing native journal binding", s => { const o = original(s, 7, true); delete o.binding; return { retained: 7, originals: [o] }; });
    await run("missing canonical payment", s => { const o = original(s, 7, true); delete o.payment; return { retained: 7, originals: [o] }; });
    await run("foreign original rail", s => { const o = original(s, 7, true); o.intent.network = "eip155:5042002"; return { retained: 7, originals: [o] }; });
    await run("payment tuple amount changed", s => { const o = original(s, 7, true); o.payment!.amount_usdc = 0.000006; return { retained: 7, originals: [o] }; });
    await run("settled label without original phase", s => { const o = original(s, 7, true); o.payment!.authorization_phase = "submission_attempted"; return { retained: 7, originals: [o] }; });
    await run("settled phase without receipt", s => { const o = original(s, 7, true); o.payment!.tx_hash = ""; return { retained: 7, originals: [o] }; });
    await run("confirmed debit exceeds retained capacity", s => ({ retained: 6, originals: [original(s, 7, true)] }));
    await run("orphan payment cannot manufacture credit", s => { const o = original(s, 7, true); return { retained: 7, extra: [o.payment!] }; });
    await run("failed original remains outside confirmed credit", s => { const o = original(s, 7, false); o.payment!.settlement_status = "failed"; o.payment!.authorization_phase = "failed"; return { retained: 0, originals: [o] }; });
    await run("legacy SQLite real retains its sub-micro tolerance", s => { const o = original(s, 7, true); o.payment!.amount_usdc = (7 + 0.0000005) / 1e6; return { retained: 7, originals: [o] }; });
    await run("difference outside legacy tolerance refuses", s => { const o = original(s, 7, true); o.payment!.amount_usdc = (7 + 0.000002) / 1e6; return { retained: 7, originals: [o] }; });
    await run("lifetime totals are not the recent-query sample", s => ({ retained: 301, originals: Array.from({ length: 301 }, () => original(s, 1, true)) }));
    return { differentialVectors: vectors, sourceImportRefusals, originalCases: 17, source: "current SQLite mainnet accounting", native: "PostgreSQL17", paidOperations: 0 };
  } finally { db.close(); }
}
