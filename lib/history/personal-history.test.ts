import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqlitePersonalHistory } from "../db/personal-history-sqlite";
import { createSupabasePersonalHistory } from "../db/personal-history-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPersonalHistory } from "./personal-history-reader";
import { parseHistoryQuery, requirePersonalHistory } from "./personal-history";

const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`, date = "2026-10-09T12:00:00.000Z", network = "eip155:5042002";
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  db.exec("CREATE TABLE query_runs(id TEXT PRIMARY KEY,created_at TEXT,question TEXT,asker TEXT,total_spent REAL,total_to_creators REAL,payment_mode TEXT,parent_id TEXT,data TEXT)");
  const insert = (id: string, extra: Record<string, unknown> = {}, wallet: string | null = owner, createdAt = date, question = "Question %_ literal") => db.prepare("INSERT INTO query_runs VALUES(?,?,?,?,?,?,?,?,?)").run(id, createdAt, question, wallet, 0.1, 0.04, "offline", null,
    JSON.stringify({ asker: wallet, answer: "private answer must never leave storage", originalFulfillment: { private: "must not leak" }, ...extra }));
  return { db, insert, store: createSqlitePersonalHistory(db) };
}
describe("bounded ordinary attributed history", () => {
  it("ties use descending id and the upper anchor excludes newer and equal-time higher inserts", async () => {
    const f = fixture(); for (const id of ["a", "b", "c", "d"]) f.insert(id);
    f.insert("foreign", {}, other); f.insert("ownerless", {}, null);
    const first = await readPersonalHistory(f.store, owner, network, { limit: 2 });
    expect(first.rows.map(row => row.id)).toEqual(["d", "c"]); expect(first.nextCursor).toBeTruthy();
    f.insert("z"); f.insert("newer", {}, owner, "2026-10-10T00:00:00.000Z");
    const next = await readPersonalHistory(f.store, owner, network, { limit: 2, cursor: first.nextCursor! });
    expect(next.rows.map(row => row.id)).toEqual(["b", "a"]); expect(next.nextCursor).toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/private answer|originalFulfillment|must not leak|foreign|ownerless/);
  });
  it("literal case-sensitive search, dates, closed provenance and funding filters have no telemetry inference", async () => {
    const f = fixture(); f.insert("web", { provenance: { version: 1, surface: "web", ownershipMethod: "session" }, askerFunded: true });
    f.insert("api", { provenance: { version: 1, surface: "api", ownershipMethod: "api-key" }, askerFunded: false });
    f.insert("legacy", { origin: "web", askerFunded: "true" });
    f.insert("malformed", { provenance: { version: 1, surface: "web", ownershipMethod: "session", extra: true } });
    expect((await readPersonalHistory(f.store, owner, network, { search: "%_", surface: "web", funding: "browser-recorded", from: date, to: date })).rows.map(row => row.id)).toEqual(["web"]);
    expect((await readPersonalHistory(f.store, owner, network, { search: "question" })).rows).toEqual([]);
    expect((await readPersonalHistory(f.store, owner, network, { surface: "unknown", funding: "other-or-unknown" })).rows.map(row => row.id)).toEqual(["malformed", "legacy"]);
    expect((await readPersonalHistory(f.store, owner, network, { surface: "api" })).rows[0].funding).toBe("other-or-unknown");
  });
  it("cursor owner, network and filters are bound before storage; malformed/cross-owner cursor refuses", async () => {
    const f = fixture(); f.insert("a"); f.insert("b");
    const first = await readPersonalHistory(f.store, owner, network, { limit: 1 }); const list = vi.fn(f.store.list);
    for (const [wallet, storeNetwork, input] of [[other, network, { cursor: first.nextCursor! }], [owner, "eip155:5042", { cursor: first.nextCursor! }], [owner, network, { cursor: first.nextCursor!, search: "different" }], [owner, network, { cursor: "___" }]] as const) {
      await expect(readPersonalHistory({ list }, wallet, storeNetwork, input)).rejects.toMatchObject({ code: "invalid_history_query" });
    }
    expect(list).not.toHaveBeenCalled();
  });
  it("rejects owner selectors, duplicate query values, invalid dates/text and excessive limits", () => {
    for (const query of ["wallet=" + other, "network=arcTestnet", "limit=51", "limit=2&limit=3", "from=2026-10-09", "to=2026-02-30T00:00:00.000Z", "search=" + "a".repeat(201), "surface=spoofed"]) expect(() => parseHistoryQuery(new URLSearchParams(query))).toThrow();
  });
  it("projection defects refuse instead of returning another owner or raw artifacts", async () => {
    const f = fixture(); f.insert("bad", { asker: other });
    await expect(readPersonalHistory(f.store, owner, network, {})).rejects.toMatchObject({ code: "history_unavailable" });
  });
  it("sealed capabilities and newly enrolled ordinary connections refuse without fallback", async () => {
    let reads = 0;
    expect(() => requirePersonalHistory(new Proxy({}, { get() { reads++; throw new Error("sealed"); } }))).toThrow("history_unavailable"); expect(reads).toBe(1);
    const f = fixture(); f.db.exec("CREATE TABLE keryx_storage_identity (id INTEGER)");
    await expect(f.store.list(owner, { filters: {}, take: 1 })).rejects.toThrow("unavailable in enrolled storage");
    expect(() => requirePersonalHistory({})).toThrow("history_unavailable");
  });
  it("Supabase uses one bounded ordinary RPC and rejects a wrong owner or unknown fields without REST fallback", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { wallet: other, rows: [] }, error: null });
    const from = vi.fn(); const store = createSupabasePersonalHistory({ rpc, from } as unknown as SupabaseClient);
    await expect(store.list(owner, { filters: { search: "%_" }, take: 26 })).rejects.toMatchObject({ code: "history_unavailable" });
    expect(rpc).toHaveBeenCalledWith("personal_history_read_v1", { p_wallet: owner, p_filters: { search: "%_" }, p_take: 26, p_upper: null, p_before: null }); expect(from).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { wallet: owner, rows: [], private: "not allowed" }, error: null });
    await expect(store.list(owner, { filters: {}, take: 26 })).rejects.toThrow("history_unavailable");
    rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    await expect(store.list(owner, { filters: {}, take: 26 })).rejects.toThrow("history_unavailable");
  });
});
