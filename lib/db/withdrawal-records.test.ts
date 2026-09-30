import { testSupabaseAuthority, supabaseTestIdentity } from "./supabase-authority-test-fixture";
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";
import { recordSqliteWithdrawal, recordSupabaseWithdrawal } from "./withdrawal-records";
import type { WithdrawalRecord } from "../types";

afterEach(() => vi.restoreAllMocks());
const record: WithdrawalRecord = { txHash: `0x${"ab".repeat(32)}`, wallet: `0x${"cd".repeat(20)}`,
  recipient: `0x${"ef".repeat(20)}`, amountUsdc: 0.05, network: "eip155:5042002",
  label: "Synthetic creator", createdAt: "2026-09-11T00:00:00.000Z" };
it("keeps the first SQLite cash-out and rejects conflicting economics without creating another row", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE withdrawals(tx_hash TEXT PRIMARY KEY,created_at TEXT,label TEXT,source_name TEXT,wallet TEXT,recipient TEXT,amount_usdc REAL,network TEXT)");
    await recordSqliteWithdrawal(db, record);
    await recordSqliteWithdrawal(db, { ...record, createdAt: "2026-09-12T00:00:00.000Z", label: "Later label" });
    expect(db.prepare("SELECT created_at,label FROM withdrawals").get()).toMatchObject({ created_at: record.createdAt, label: record.label });
    for (const delta of [{ wallet: record.recipient }, { recipient: record.wallet }, { amountUsdc: 1 }, { network: "eip155:1" }])
      await expect(recordSqliteWithdrawal(db, { ...record, ...delta })).rejects.toThrow("conflicting");
    expect(db.prepare("SELECT count(*) n FROM withdrawals").get()?.n).toBe(1);
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (sql.startsWith("SELECT *")) vi.spyOn(statement, "get").mockImplementationOnce(() => { throw new Error("Lost readback"); });
      return statement;
    });
    await expect(recordSqliteWithdrawal(db, record)).rejects.toThrow("Lost readback");
    vi.restoreAllMocks(); await recordSqliteWithdrawal(db, record);
  } finally { db.close(); }
});

it("uses Supabase ignore-duplicates with verified readback and propagates HTTP errors", async () => {
  let saved: Record<string, unknown> | undefined, failWrite = false, missingRead = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body));
    expect(init?.method).toBe("POST");
    expect(body.p_expected_identity).toEqual(supabaseTestIdentity);
    if (url.pathname.endsWith("/storage_record_supabase_withdrawal")) {
      if (failWrite) return Response.json({ message: "private database error" }, { status: 500 });
      saved ??= body.p_row; return new Response(null, { status: 204 });
    }
    expect(url.pathname).toBe("/rest/v1/rpc/storage_record_supabase_withdrawal_2");
    expect(body.p_tx_hash).toBe(record.txHash);
    return Response.json(missingRead ? null : saved);
  };
  const sb = await testSupabaseAuthority(createClient("https://database.synthetic.invalid", "synthetic-key", { global: { fetch: fetcher }, auth: { persistSession: false } }));
  await recordSupabaseWithdrawal(sb, record);
  await recordSupabaseWithdrawal(sb, { ...record, label: "Later label" });
  expect(saved?.label).toBe(record.label);
  await expect(recordSupabaseWithdrawal(sb, { ...record, amountUsdc: 1 })).rejects.toThrow("conflicting");
  missingRead = true; await expect(recordSupabaseWithdrawal(sb, record)).rejects.toThrow("readback");
  missingRead = false; failWrite = true;
  await expect(recordSupabaseWithdrawal(sb, record)).rejects.toThrow(/^Withdrawal record write unavailable$/);
});

it("does not read back or claim success after full-identity SQL refusal", async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: "P0001",
    message: "storage identity refused: identity_mismatch", details: "synthetic private detail" }, { status: 400 }));
  const authority = await testSupabaseAuthority(createClient("https://fixture.invalid", "synthetic-no-authority",
    { auth: { persistSession: false }, global: { fetch: http } }));
  await expect(recordSupabaseWithdrawal(authority, record)).rejects.toThrow(/^Withdrawal record write unavailable$/);
  expect(http).toHaveBeenCalledTimes(1);
});
