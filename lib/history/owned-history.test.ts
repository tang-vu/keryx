import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Vite's BASE_URL is an asset path ("/"), not the server's canonical claim origin.
// Pin this isolated transport fixture without changing the runtime origin guard.
vi.mock("../config", async original => {
  const actual = await original<typeof import("../config")>();
  return { ...actual, config: { ...actual.config, baseUrl: "https://synthetic-history.example" } };
});
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "../db/run-claims-sqlite";
import { createSqliteRunOwnershipHistory } from "../db/run-ownership-history-sqlite";
import { createSupabaseRunOwnershipHistory } from "../db/run-ownership-history-supabase";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { createSupabaseRunPrivacy } from "../db/run-privacy-supabase";
import { createSqlitePersonalHistory } from "../db/personal-history-sqlite";
import { createSupabasePersonalHistory } from "../db/personal-history-supabase";
import { readOwnedDetail, readOwnedHistory, type OwnedHistoryDB } from "./owned-history-reader";
import { exportOwnedHistory, historyCsv } from "./owned-history-export";
import { parseOwnedQuery } from "./owned-history";
import { RUN_SURFACES } from "../research/run-provenance";
import type { QueryRun } from "../types";
import type { KeryxDB } from "../db/keryx-db";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { createOwnedHistoryRoute } from "./owned-history-route";
import { createOwnedHistoryClient } from "./owned-history-client";
import { registerOwnedHistoryTools } from "./owned-history-mcp";
import { runOwnedHistoryCli } from "./owned-history-cli";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NextRequest } from "next/server";
import { POST as mcpPost } from "../../app/mcp/route";
import * as apiKeys from "../api-keys";
import * as database from "../db";
import { config } from "../config";
const alice = `0x${"a".repeat(40)}`, member = `0x${"b".repeat(40)}`, foreign = `0x${"c".repeat(40)}`;
const binding = { network: "eip155:5042002" as const, origin: "https://synthetic-history.example" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const connections: DatabaseSync[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { connections.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture() {
  const sql = new DatabaseSync(":memory:"); connections.push(sql); installSqliteApplicationSchema(sql);
  sql.exec(`${RUN_CLAIMS_SQL};${RUN_PRIVACY_SQL};`);
  const now = Date.now(), date = new Date(now - 1000).toISOString();
  for (const wallet of [alice, member]) sql.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sha(wallet), wallet, now - 2000, now + 60000);
  const claims = createSqliteRunClaims(sql), ownership = createSqliteRunOwnershipHistory(sql), privacy = createSqliteRunPrivacy(sql, ownership), personal = createSqlitePersonalHistory(sql);
  const db: OwnedHistoryDB = { personalHistory: personal, runOwnershipHistory: ownership, runPrivacy: privacy, runPrivacyActive: true };
  const save = (id: string, wallet: string | null = alice, extra: Partial<QueryRun> = {}) => {
    const run: QueryRun = { id, question: `Question %_ ${id}`, answer: `PRIVATE original ${id}`, budget: .1, engine: "heuristic", totalSpent: .03,
      totalToCreators: .02, subClaims: [], decisions: [], citations: [{ marker: "S1", sourceId: "creator", sourceName: "Creator", weight: 1, reward: .02, rationale: "Private" }], trace: [],
      createdAt: date, paymentMode: "offline", ...(wallet ? { asker: wallet } : {}), ...extra };
    writeSqliteQueryRun(sql, run, true); return run;
  };
  const payment = (id: string, queryId: string, payer = alice, extra: Record<string, unknown> = {}) => {
    const p = { id, query_id: queryId, kind: "citation", source_id: "creator", source_name: "Creator", payer, payee: foreign, amount_usdc: .02,
      network: binding.network, tx_hash: "synthetic-receipt-reference", settled: 1, settlement_status: "settled", created_at: date, rationale: "PRIVATE journal", ...extra };
    sql.prepare(`INSERT INTO payment_events(${Object.keys(p).join(",")}) VALUES(${Object.keys(p).map(() => "?").join(",")})`).run(...Object.values(p) as (string | number | null)[]);
  };
  return { sql, db, personal, privacy, ownership, claims, save, payment, date };
}
/** Mocked Supabase transport backed by the isolated SQLite fixture's admitted source ports.
 * Exercises RPC/projection contracts, not a claim of live PostgreSQL or production readiness. */
function supabase(f: ReturnType<typeof fixture>) {
  const rpc = vi.fn((name, args) => ({ abortSignal: async () => {
    const owner = args.p_wallet;
    if (name === "anonymous_run_claim_history_list_v1") return { error: null, data: { version: 1, wallet: owner, binding,
      rows: await f.ownership.list(owner, { binding, filters: args.p_filters, take: args.p_take, upper: args.p_upper ?? undefined, before: args.p_before ?? undefined }) } };
    if (name === "run_privacy_v1" && args.p_action === "owner") return { error: null, data: { version: 1, action: "owner", id: args.p_id,
      result: await f.privacy.owner(args.p_id, { wallet: args.p_actor.wallet, binding: args.p_actor.binding }) } };
    throw new Error("Unexpected RPC");
  } }));
  const from = vi.fn((table: string) => {
    expect(table).toBe("payment_events"); let id = "", take = 0;
    const query = { select: vi.fn((fields: string) => { expect(fields).not.toMatch(/rationale|authorization|grant|data/); return query; }),
      eq: (field: string, value: string) => { expect(field).toBe("query_id"); id = value; return query; }, or: () => query, order: () => query,
      limit: (value: number) => { take = value; return query; }, abortSignal: async () => ({ error: null,
        data: (await f.personal.receipts!(id, take)).map(p => ({ id: p.id, query_id: p.queryId, kind: p.kind, source_id: p.sourceId, source_name: p.sourceName,
          payer: p.payer, payee: p.payee, amount_usdc: p.amountUsdc, network: p.network, tx_hash: p.txHash, settled: p.settled, settlement_status: p.settlementStatus, created_at: p.createdAt })) }) };
    return query;
  });
  const client = { rpc, from } as unknown as SupabaseClient;
  return { db: { ...f.db, personalHistory: createSupabasePersonalHistory(client), runOwnershipHistory: createSupabaseRunOwnershipHistory(client),
    runPrivacy: createSupabaseRunPrivacy(client, true) } satisfies OwnedHistoryDB, rpc, from };
}
describe.each(["SQLite", "mocked Supabase"])("owned history %s", backend => {
  const port = (f: ReturnType<typeof fixture>) => backend === "SQLite" ? f.db : supabase(f).db;
  it("includes every recorded surface and a proven claim, excludes others/ownerless, never rewrites the original", async () => {
    const f = fixture();
    for (const [i, surface] of RUN_SURFACES.entries()) f.save(`surface_${i}`, alice, { provenance: { version: 1, surface, ownershipMethod: "api-key" } });
    f.save("foreign", foreign); f.save("unowned", null); const original = f.save("claimed", null);
    await f.claims.issue({ runId: original.id, completedAt: f.date, tokenHash: sha("isolated-ticket"), binding });
    await f.claims.claim({ tokenHash: sha("isolated-ticket"), wallet: alice, sessionHash: sha(alice), binding });
    const page = await readOwnedHistory(port(f), alice, binding, { limit: 50 });
    expect(page.rows).toHaveLength(RUN_SURFACES.length + 1); expect(page.rows.find(r => r.id === "claimed")?.ownership.method).toBe("claimed");
    expect(JSON.stringify(page)).not.toMatch(/PRIVATE|foreign|unowned|tokenHash|sessionHash/);
    expect((await readOwnedDetail(port(f), alice, binding, original.id))?.run).toEqual(original);
    expect(await readOwnedDetail(port(f), foreign, binding, original.id)).toBeNull();
    expect(f.sql.prepare("SELECT asker FROM query_runs WHERE id='claimed'").get()?.asker).toBeNull();
  });
  it("filters literal question text/date/surface/visibility/network/settled funding, keeps own and sponsored amounts separate", async () => {
    const f = fixture(); f.save("own", alice, { paymentMode: "real", provenance: { version: 1, surface: "api", ownershipMethod: "api-key" } }); f.payment("ownpay", "own");
    f.save("sponsored", alice, { paymentMode: "real" }); f.payment("sponsoredpay", "sponsored", foreign); f.save("pending"); f.payment("pendingpay", "pending", alice, { settled: 0, settlement_status: "pending", tx_hash: null });
    await f.privacy.change("own", { wallet: alice, binding, sessionHash: sha(alice) }, { visibility: "public", revision: 0, requestId: randomUUID() });
    const db = port(f), page = await readOwnedHistory(db, alice, binding, { search: "%_", from: f.date, to: f.date, surface: "api", visibility: "public", network: binding.network, funding: "paid" });
    expect(page.rows.map(r => r.id)).toEqual(["own"]); expect(page.rows[0]).toMatchObject({ ownSettledSpendMicros: 20000, sponsoredSettledSpendMicros: 0 });
    expect(page.rows[0].paidCreators).toHaveLength(1); expect(JSON.stringify(page)).not.toContain("PRIVATE journal");
    expect((await readOwnedHistory(db, alice, binding, { funding: "sponsored" })).rows[0].sponsoredSettledSpendMicros).toBe(20000);
    expect((await readOwnedHistory(db, alice, binding, { funding: "unknown" })).rows.map(r => r.id)).toEqual(["pending"]);
    expect((await readOwnedHistory(db, alice, binding, { search: "question" })).rows).toEqual([]);
  });
  it("bounds stable tied keysets, binds filters/owner/claim-origin and excludes newer insertions", async () => {
    const f = fixture(); for (const id of ["a", "b", "c", "d"]) f.save(id);
    const db = port(f), first = await readOwnedHistory(db, alice, binding, { limit: 2 }); expect(first.rows.map(r => r.id)).toEqual(["d", "c"]);
    f.save("z"); f.save("new", alice, { createdAt: new Date(Date.now() + 1000).toISOString() });
    expect((await readOwnedHistory(db, alice, binding, { limit: 2, cursor: first.nextCursor! })).rows.map(r => r.id)).toEqual(["b", "a"]);
    for (const [wallet, ownBinding, query] of [[foreign, binding, { cursor: first.nextCursor! }], [alice, { ...binding, origin: "https://other.example" }, { cursor: first.nextCursor! }],
      [alice, binding, { cursor: first.nextCursor!, visibility: "private" as const }]] as const)
      await expect(readOwnedHistory(db, wallet, ownBinding, query)).rejects.toMatchObject({ code: "invalid_history_query" });
  });
  it("proves member authority through the optional current read port and invalidates unlink/revision cursors", async () => {
    const f = fixture(); f.save("alice"); f.save("member", member); f.save("foreign", foreign);
    let revision = 1, wallets = [alice, member]; const db = { ...port(f), historyMembership: { resolve: async () => ({ accountId: "synthetic-account", revision, wallets }) } };
    const first = await readOwnedHistory(db, alice, binding, { limit: 1 }); expect(first.scope).toBe("account-owned-current-store"); expect(first.rows[0].id).toBe("member");
    expect((await readOwnedHistory(db, alice, binding, { cursor: first.nextCursor! })).rows.map(r => r.id)).toEqual(["alice"]);
    revision++; wallets = [alice]; await expect(readOwnedHistory(db, alice, binding, { cursor: first.nextCursor! })).rejects.toMatchObject({ code: "invalid_history_query" });
    expect(await readOwnedDetail(db, alice, binding, "member")).toBeNull();
    expect((await readOwnedHistory(port(f), alice, binding, {})).rows.map(r => r.id)).toEqual(["alice"]);
  });
  it("erased research disappears, privacy unavailable refuses without legacy/private fallback", async () => {
    const f = fixture(); f.save("erase"); f.save("keep");
    await f.privacy.erase("erase", { wallet: alice, binding, sessionHash: sha(alice) }, { revision: 0, requestId: randomUUID() });
    expect((await readOwnedHistory(port(f), alice, binding, {})).rows.map(r => r.id)).toEqual(["keep"]);
    const list = vi.fn(); await expect(readOwnedHistory({ ...port(f), runPrivacyActive: false, personalHistory: { list } }, alice, binding, {})).rejects.toThrow("privacy_unavailable"); expect(list).not.toHaveBeenCalled();
  });
  it.each(["erase", "revision", "ownership"] as const)("refuses %s changes while receipt IO is pending", async change => {
    const f = fixture(); f.save("owned", alice, { paymentMode: "real" }); f.payment("retained", "owned");
    const base = port(f), entered = deferred(), release = deferred(); let allowed = true;
    const db: OwnedHistoryDB = { ...base,
      runPrivacy: { ...base.runPrivacy!, owner: async (id, actor) => allowed ? base.runPrivacy!.owner(id, actor) : null },
      personalHistory: { ...base.personalHistory!, receipts: async (id, take) => {
        const receipts = await base.personalHistory!.receipts!(id, take);
        entered.resolve(); await release.promise; return receipts;
      } },
    };
    const pending = readOwnedHistory(db, alice, binding, {});
    await entered.promise;
    try {
      if (change === "erase") await f.privacy.erase("owned", { wallet: alice, binding, sessionHash: sha(alice) }, { revision: 0, requestId: randomUUID() });
      else if (change === "revision") await f.privacy.change("owned", { wallet: alice, binding, sessionHash: sha(alice) }, { visibility: "public", revision: 0, requestId: randomUUID() });
      else allowed = false; // Simulate current proof refusal, never an ownership grant.
    } finally { release.resolve(); }
    await expect(pending).rejects.toMatchObject({ code: "history_unavailable" });
    expect(f.sql.prepare("SELECT amount_usdc FROM payment_events WHERE id='retained'").get()?.amount_usdc).toBe(.02);
  });
  it("fences an earlier row changed during a later candidate's receipt IO", async () => {
    const f = fixture(); f.save("a"); f.save("b"); const base = port(f), entered = deferred(), release = deferred();
    const db: OwnedHistoryDB = { ...base, personalHistory: { ...base.personalHistory!, receipts: async (id, take) => {
      const receipts = await base.personalHistory!.receipts!(id, take);
      if (id === "a") { entered.resolve(); await release.promise; }
      return receipts;
    } } };
    const pending = readOwnedHistory(db, alice, binding, {}); await entered.promise;
    try { await f.privacy.erase("b", { wallet: alice, binding, sessionHash: sha(alice) }, { revision: 0, requestId: randomUUID() }); }
    finally { release.resolve(); }
    await expect(pending).rejects.toMatchObject({ code: "history_unavailable" });
  });
  it("fences rows accumulated on a previous export page", async () => {
    const f = fixture(); for (let i = 0; i < 51; i++) f.save(`run_${String(i).padStart(3, "0")}`);
    const base = port(f), entered = deferred(), release = deferred();
    const db: OwnedHistoryDB = { ...base, personalHistory: { ...base.personalHistory!, receipts: async (id, take) => {
      const receipts = await base.personalHistory!.receipts!(id, take);
      if (id === "run_000") { entered.resolve(); await release.promise; }
      return receipts;
    } } };
    const pending = exportOwnedHistory(db, alice, binding, {}); await entered.promise;
    try { await f.privacy.erase("run_050", { wallet: alice, binding, sessionHash: sha(alice) }, { revision: 0, requestId: randomUUID() }); }
    finally { release.resolve(); }
    await expect(pending).rejects.toMatchObject({ code: "history_unavailable" });
  });
});
it("filtered scan continuations allow whole bounded exports; CSV protects formulas and reports truncation even empty", async () => {
  const f = fixture(); for (let i = 0; i < 55; i++) f.save(`run_${String(i).padStart(3,"0")}`);
  f.save("first", alice, { question: '=HYPERLINK("https://invalid.example")' });
  const first = await readOwnedHistory(f.db, alice, binding, { network: "unknown", visibility: "public" });
  expect(first.rows).toEqual([]); expect(first.scanLimited).toBe(true); expect(first.nextCursor).toBeTruthy();
  const empty = await exportOwnedHistory(f.db, alice, binding, { visibility: "public" }); expect(empty.complete).toBe(true); expect(empty.rows).toEqual([]);
  const all = await exportOwnedHistory(f.db, alice, binding, {}); expect(all.rows).toHaveLength(56); expect(all.complete).toBe(true);
  expect(historyCsv(all)).toContain("'=HYPERLINK"); expect(all.rows.find(r => r.id === "first")?.question).toBe('=HYPERLINK("https://invalid.example")');
  expect(historyCsv({ ...empty, complete: false, truncated: true, nextCursor: "bounded_cursor" })).toContain('"false","true","bounded_cursor"');
});
it("mid-read membership revocation discards private output; wrong/malformed capability never grants ownership", async () => {
  const f = fixture(); f.save("owned"); let calls = 0;
  const db = { ...f.db, historyMembership: { resolve: async () => ({ accountId: "synthetic", revision: ++calls, wallets: [alice] }) } };
  await expect(readOwnedHistory(db, alice, binding, {})).rejects.toThrow("history_unavailable");
  await expect(readOwnedHistory({ ...f.db, historyMembership: { resolve: async () => ({ accountId: "synthetic", revision: 0, wallets: [foreign] }) } }, alice, binding, {})).rejects.toThrow("history_unavailable");
});
it("query validation rejects owner selectors, duplicates, overflow, malformed dates and unsupported filters", () => {
  for (const s of ["wallet=" + foreign, "limit=51", "search=a&search=b", "from=2026-02-30T00:00:00.000Z", "network=arcTestnet", "visibility=hidden", "funding=free"]) expect(() => parseOwnedQuery(new URLSearchParams(s))).toThrow();
});
it("actual isolated key revocation, scope and owner fences protect the API/export/detail without cookie fallback", async () => {
  const f = fixture(); f.save("owned"); f.save("foreign", foreign);
  const auth = new SqliteAdapter(":memory:"); await auth.init();
  try {
    const raw = `kx_live_${"1".repeat(96)}`, digest = sha(raw), prefix = raw.slice(0,16), minted = await auth.mintApiKey(alice, prefix, digest, "synthetic-history", "history:read");
    const session = vi.fn().mockResolvedValue({ db: f.db, wallet: foreign }), database = vi.fn().mockResolvedValue(f.db);
    const deps = { session, db: database, binding, key: async (value: string) => auth.verifyApiKey(value.slice(0,16), sha(value)) };
    const request = (path = "", expected = alice) => new Request(`https://synthetic-history.example/api/me/asks${path}`, { headers: { Authorization: `Bearer ${raw}`, "X-Keryx-Expected-Wallet": expected } });
    const route = createOwnedHistoryRoute(deps as unknown as Parameters<typeof createOwnedHistoryRoute>[0]);
    const response = await route(request()); expect(response.status).toBe(200); expect((await response.json()).rows.map((r: {id:string}) => r.id)).toEqual(["owned"]);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await route(request("", foreign))).status).toBe(409); expect((await route(request("?wallet=" + foreign))).status).toBe(400);
    const detail = createOwnedHistoryRoute(deps as unknown as Parameters<typeof createOwnedHistoryRoute>[0], "detail");
    expect((await detail(request(), "foreign")).status).toBe(404); expect((await detail(request("?format=report"), "owned")).status).toBe(200);
    const exported = await createOwnedHistoryRoute(deps as unknown as Parameters<typeof createOwnedHistoryRoute>[0], "export")(request("/export"));
    expect((await exported.json()).rows.map((r: {id:string}) => r.id)).toEqual(["owned"]);
    await auth.revokeApiKey(minted.id, foreign); expect((await route(request())).status).toBe(200);
    await auth.revokeApiKey(minted.id, alice); expect((await route(request())).status).toBe(401); expect(session).not.toHaveBeenCalled();
    const key = vi.fn().mockResolvedValue({ walletAddress: alice, scopes: "ask,export" });
    const legacy = createOwnedHistoryRoute({ ...deps, key } as unknown as Parameters<typeof createOwnedHistoryRoute>[0]);
    database.mockClear(); expect((await legacy(request())).status).toBe(403); expect(database).not.toHaveBeenCalled(); expect(session).not.toHaveBeenCalled();
    expect((await legacy(new Request("https://synthetic-history.example/api/me/asks", { headers: { Authorization: "Basic refused" } }))).status).toBe(401);
  } finally { auth.close(); }
});
const sessionFormats = [
  ["list", "json"], ["export", "json"], ["export", "csv"],
  ["detail", "report"], ["detail", "receipts"], ["detail", "bibtex"],
] as const;
const sessionChanges = ["revoked", "expired", "replaced", "wallet-changed", "storage-error"] as const;
it.each(sessionFormats.flatMap(([action, format]) => sessionChanges.map(change => ({ action, format, change }))))(
  "discards $action/$format private output after pending IO when the session is $change", async ({ action, format, change }) => {
    const f = fixture(); f.save("owned"); f.payment("retained", "owned");
    const entered = deferred(), release = deferred(), original = f.db;
    const block = async <T,>(value: T) => { entered.resolve(); await release.promise; return value; };
    const db = {
      ...original,
      personalHistory: { ...original.personalHistory!, receipts: async (id: string, take: number) =>
        block(await original.personalHistory!.receipts!(id, take)) },
      runPrivacy: { ...original.runPrivacy!, owner: async (...args: Parameters<NonNullable<OwnedHistoryDB["runPrivacy"]>["owner"]>) => {
        const value = await original.runPrivacy!.owner(...args);
        return action === "detail" && format !== "receipts" ? block(value) : value;
      } },
    } as KeryxDB;
    let currentId = sha(alice), unavailable = false;
    const session = vi.fn(async () => {
      if (unavailable) throw new Error("Synthetic session storage unavailable");
      const row = f.sql.prepare("SELECT hash,wallet,expires_at FROM web_sessions WHERE hash=?").get(currentId);
      if (!row || Number(row.expires_at) <= Date.now()) return Response.json({ error: "unauthenticated" }, { status: 401 });
      return { db, wallet: String(row.wallet), currentId: String(row.hash) };
    });
    const key = vi.fn(), getDb = vi.fn();
    const route = createOwnedHistoryRoute({ session, key, db: getDb, binding }, action);
    const path = action === "detail" ? "/api/me/asks/owned" : action === "export" ? "/api/me/asks/export" : "/api/me/asks";
    const pending = route(new Request(binding.origin + path + "?format=" + format), action === "detail" ? "owned" : undefined);
    await Promise.race([entered.promise, pending.then(() => { throw new Error("Returned before pending private IO"); })]);
    try {
      if (change === "revoked") f.sql.prepare("DELETE FROM web_sessions WHERE hash=?").run(currentId);
      else if (change === "expired") f.sql.prepare("UPDATE web_sessions SET expires_at=issued_at+1 WHERE hash=?").run(currentId);
      else if (change === "wallet-changed") f.sql.prepare("UPDATE web_sessions SET wallet=? WHERE hash=?").run(foreign, currentId);
      else if (change === "replaced") {
        currentId = sha("replacement-session");
        f.sql.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(currentId, alice, Date.now() - 1, Date.now() + 60000);
      } else unavailable = true;
    } finally { release.resolve(); }
    const response = await pending;
    expect(response.status).toBe(change === "storage-error" ? 503 : change === "replaced" || change === "wallet-changed" ? 409 : 401);
    const body = await response.text();
    expect(body).not.toContain("Question %_ owned"); expect(body).not.toContain("PRIVATE original");
    expect(body).not.toContain(alice); expect(body).not.toContain(currentId);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(session).toHaveBeenCalledTimes(2); expect(key).not.toHaveBeenCalled(); expect(getDb).not.toHaveBeenCalled();
    expect(f.sql.prepare("SELECT amount_usdc FROM payment_events WHERE id='retained'").get()?.amount_usdc).toBe(.02);
  });
it.each(sessionFormats)("keeps exact active session output for %s/%s", async (action, format) => {
  const f = fixture(); f.save("owned"); const db = f.db as KeryxDB;
  const session = vi.fn(async () => ({ db, wallet: alice, currentId: sha(alice) }));
  const response = await createOwnedHistoryRoute({ session, key: vi.fn(), db: vi.fn(), binding }, action)(
    new Request(binding.origin + "/api/me/asks?format=" + format), action === "detail" ? "owned" : undefined);
  expect(response.status).toBe(200); expect(session).toHaveBeenCalledTimes(2);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("refuses a session context without a stable current session identifier before reading private rows", async () => {
  const f = fixture(), list = vi.fn(), db = { ...f.db, personalHistory: { list } } as unknown as KeryxDB;
  const session = async () => ({ db, wallet: alice, currentId: "" });
  const response = await createOwnedHistoryRoute({ session, key: vi.fn(), db: vi.fn(), binding })(new Request(binding.origin + "/api/me/asks"));
  expect(response.status).toBe(503); expect(list).not.toHaveBeenCalled();
});
it("source mutation stays on the existing interactive-session privacy contract; keys only get read capabilities", async () => {
  const f = fixture(); f.save("owned"); const db = f.db as KeryxDB;
  const deps = { binding, db: async () => db, key: async () => null, session: async () => ({ db, wallet: alice, currentId: sha(alice) }) };
  const route = createOwnedHistoryRoute(deps, "detail");
  expect((await route(new Request("https://synthetic-history.example/api/me/asks/owned?format=visibility"), "owned")).status).toBe(400);
  await expect(f.privacy.change("owned", { wallet: alice, binding }, { visibility: "public", revision: 0, requestId: randomUUID() })).rejects.toThrow();
});
it("packaged client and real MCP SDK tool contracts use the same authenticated API metadata without signer/owner selectors", async () => {
  const f = fixture(); f.save("owned"); const raw = `kx_live_${"1".repeat(96)}`, db = f.db as KeryxDB;
  const deps = { binding, db: async () => db, session: async () => new Response(null,{status:401}), key: async () => ({ walletAddress: alice, scopes: "history:read" }) };
  const requests: Request[] = [];
  const fetcher = vi.fn(async (url, init) => { const req = new Request(url, init); requests.push(req);
    return createOwnedHistoryRoute(deps, new URL(req.url).pathname.endsWith("/export") ? "export" : "list")(req); }) as unknown as typeof fetch;
  const bridge = createOwnedHistoryClient(binding.origin, () => raw, fetcher), server = new McpServer({name:"isolated-history",version:"1"});
  registerOwnedHistoryTools(server, bridge.read, bridge.export);
  const client = new Client({name:"isolated-test",version:"1"}), [left,right] = InMemoryTransport.createLinkedPair();
  await server.connect(left); await client.connect(right);
  try {
    const result = await client.callTool({name:"history_owned_read",arguments:{search:"%_",limit:2}});
    expect(result.structuredContent).toEqual(await readOwnedHistory(f.db,alice,binding,{search:"%_",limit:2}));
    const exported = await client.callTool({name:"history_export",arguments:{}});
    expect(exported.structuredContent).toMatchObject({complete:true,truncated:false,rows:[{id:"owned"}]});
    expect(requests.map(r=>new URL(r.url).pathname)).toEqual(["/api/me/asks","/api/me/asks/export"]);
    const output: string[] = [];
    expect(await runOwnedHistoryCli(["list", "--search", "%_", "--limit", "2"], {
      key: raw, baseUrl: binding.origin, fetcher, write: text => output.push(text), error: text => { throw new Error(text); },
    })).toBe(0);
    expect(JSON.parse(output.join(""))).toEqual(result.structuredContent);
    expect(requests.every(r=>r.method==="GET" && r.headers.get("authorization")===`Bearer ${raw}` && r.credentials==="omit" && r.redirect==="error")).toBe(true);
    const denied = await client.callTool({name:"history_owned_read",arguments:{wallet:foreign}}); expect(denied.isError).toBe(true);
  } finally {await client.close();await server.close();}
});
it("remote MCP returns the web/API contract with explicit scope, and mixed research cannot consume sponsored admission", async () => {
  const f = fixture(); f.save("owned"); const usage = vi.fn(), raw = `kx_live_${"1".repeat(96)}`;
  const verify = vi.spyOn(apiKeys,"verifyApiKey").mockResolvedValue({walletAddress:alice,keyId:"isolated-key",scopes:"history:read",sourceIds:null});
  const db = vi.spyOn(database,"getDb").mockResolvedValue({...f.db,incrementUsage:usage} as unknown as KeryxDB);
  const body = {jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"history_owned_read",arguments:{limit:2}}};
  const req = (value:unknown) => new NextRequest("http://localhost:3000/mcp", {method:"POST",headers:{Authorization:`Bearer ${raw}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18"},body:JSON.stringify(value)});
  const response = await mcpPost(req(body));expect(response.status).toBe(200);
  const expected = await readOwnedHistory(f.db,alice,{network:config.networkId as typeof binding.network,origin:config.baseUrl},{limit:2});
  expect((await response.json()).result.structuredContent).toEqual(expected);expect(usage).not.toHaveBeenCalled();
  db.mockClear(); expect((await mcpPost(req([body,{...body,id:2,params:{name:"research",arguments:{question:"never run"}}}]))).status).toBe(403);expect(db).not.toHaveBeenCalled();
  verify.mockResolvedValue(null); expect((await mcpPost(req(body))).status).toBe(401);expect(db).not.toHaveBeenCalled();
});
it.each([
  ["history_owned_read", "revoked"], ["history_owned_read", "narrowed"], ["history_owned_read", "wallet-changed"],
  ["history_export", "revoked"], ["history_export", "narrowed"], ["history_export", "wallet-changed"],
] as const)("%s withholds private output when key rights are %s during IO", async (name, change) => {
    const f = fixture(); f.save("owned"); const entered = deferred(), release = deferred(), usage = vi.fn();
    const raw = `kx_live_${"1".repeat(96)}`;
    let current: Awaited<ReturnType<typeof apiKeys.verifyApiKey>> = { walletAddress: alice, keyId: "isolated-key", scopes: "history:read", sourceIds: null };
    const verify = vi.spyOn(apiKeys, "verifyApiKey").mockImplementation(async () => current);
    vi.spyOn(database, "getDb").mockResolvedValue({ ...f.db, incrementUsage: usage,
      personalHistory: { ...f.personal, receipts: async (id: string, take: number) => {
        const receipts = await f.personal.receipts!(id, take); entered.resolve(); await release.promise; return receipts;
      } },
    } as unknown as KeryxDB);
    const request = new NextRequest("http://localhost:3000/mcp", { method: "POST", headers: {
      Authorization: `Bearer ${raw}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) });
    const pending = mcpPost(request);
    await Promise.race([entered.promise, pending.then(() => { throw new Error("MCP returned before the blocked receipt read"); })]);
    current = change === "revoked" ? null : { walletAddress: change === "wallet-changed" ? foreign : alice,
      keyId: "isolated-key", scopes: change === "narrowed" ? "ask,export" : "history:read", sourceIds: null };
    release.resolve();
    const response = await pending; expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
    const wire = JSON.stringify(result);
    for (const privateValue of ["Question %_ owned", "PRIVATE original", raw, alice, "ownerWallet", "rows"]) expect(wire).not.toContain(privateValue);
    expect(verify).toHaveBeenCalledTimes(2); expect(usage).not.toHaveBeenCalled();
});
it("bounded receipt overflow and fractional micro-USDC never become complete spend or fake paid evidence",async()=>{
  const f=fixture();f.save("overflow",alice,{paymentMode:"real"});for(let i=0;i<201;i++)f.payment(`p${i}`,"overflow");
  f.save("fractional",alice,{paymentMode:"real"});f.payment("fractional","fractional",alice,{amount_usdc:0.0000001});
  const page=await readOwnedHistory(f.db,alice,binding,{});
  expect(page.rows.find(r=>r.id==="overflow")).toMatchObject({receiptsTruncated:true,ownSettledSpendMicros:null,funding:"unknown"});
  expect(page.rows.find(r=>r.id==="fractional")).toMatchObject({ownSettledSpendMicros:null,funding:"unknown",paidCreators:[]});
  const abort=new AbortController();abort.abort();await expect(readOwnedHistory(f.db,alice,binding,{},abort.signal)).rejects.toThrow("history_unavailable");
});
