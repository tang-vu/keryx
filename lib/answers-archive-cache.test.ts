import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryRun } from "./types";
import type { PrivacyList } from "./run-privacy/contracts";

const fixtures = vi.hoisted(() => ({ db: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: fixtures.db }));
vi.mock("./history/testnet-archive", () => ({ getTestnetArchive: fixtures.archive }));

function run(id: string, question = "Same question?", rich = false): QueryRun {
  return { id, question, answer: `${id} answer sentinel`, createdAt: "2026-10-12T00:00:00.000Z", engine: "fixture",
    budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], trace: [],
    citations: Array.from({ length: rich ? 3 : 1 }, (_, i) => ({ marker: `S${i + 1}`, sourceId: "source", sourceName: "Fixture", weight: 1, reward: 0, rationale: "" })) };
}
// Mirrors the admitted port's public/unerased storage contract. Actual SQLite
// adapter admission is also exercised by run-privacy/public-lists.test.ts.
function listing(rows: QueryRun[], hidden = new Set<string>()) {
  return (query: PrivacyList) => rows.filter(row => !hidden.has(row.id) && (!query.ids || query.ids.includes(row.id)) &&
    (!query.before || row.createdAt < query.before.createdAt || row.createdAt === query.before.createdAt && row.id < query.before.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, query.take);
}
function admit(list: (query: PrivacyList) => Promise<QueryRun[]> | QueryRun[]) {
  const raw = vi.fn(() => { throw Error("Broad original enumeration is forbidden"); });
  fixtures.db.mockResolvedValue({ runPrivacyActive: true, runPrivacy: { list }, iterateRecentQueries: raw });
  return raw;
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  fixtures.archive.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("archive publication admission", () => {
  it("excludes private, unlisted and erased rich duplicates before selection", async () => {
    const rows = [run("private", undefined, true), run("unlisted", undefined, true), run("erased", undefined, true), run("public")];
    const raw = admit(listing(rows, new Set(["private", "unlisted", "erased"])));
    const { getArchiveCached } = await import("./answers-archive-cache");
    const entries = await getArchiveCached();
    expect(entries.map(row => row.id)).toEqual(["public"]);
    expect(JSON.stringify(entries)).not.toMatch(/private answer|unlisted answer|erased answer/);
    expect(fixtures.archive).not.toHaveBeenCalled(); expect(raw).not.toHaveBeenCalled();
  });

  it("rechecks an early winner revoked during the scan", async () => {
    const early = run("early"), later = run("later", "Another question?"), hidden = new Set<string>();
    const list = listing([early, later], hidden);
    admit(query => { const rows = list(query); if (!query.ids) hidden.add("early"); return rows; });
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect((await getArchiveCached()).map(row => row.id)).toEqual(["later"]);
  });

  it("returns current body rather than the earlier admitted text", async () => {
    const old = run("current"), fresh = { ...old, answer: "Current publication sentinel" };
    admit(query => query.ids ? [fresh] : query.before ? [] : [old]);
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect((await getArchiveCached())[0].answerSnippet).toBe(fresh.answer);
  });

  it("does not serve legacy cached text after admitted privacy or a subsequent database outage", async () => {
    const legacy = run("legacy");
    fixtures.db.mockResolvedValue({ runPrivacyActive: false, async *iterateRecentQueries() { yield legacy; } });
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect((await getArchiveCached()).map(row => row.id)).toEqual(["legacy"]);
    admit(() => []);
    expect(await getArchiveCached()).toEqual([]);
    fixtures.db.mockRejectedValue(new Error("Unavailable privacy database"));
    expect(await getArchiveCached()).toEqual([]);
  });

  it("does not publish an in-flight legacy rebuild after a concurrent reader admits privacy", async () => {
    const legacy = run("legacy"), historical = run("historical", "Historical question?");
    let announce!: () => void, release!: (value: unknown) => void;
    const started = new Promise<void>(resolve => { announce = resolve; });
    fixtures.archive.mockImplementation(() => { announce(); return new Promise(resolve => { release = resolve; }); });
    fixtures.db.mockResolvedValue({ runPrivacyActive: false, async *iterateRecentQueries() { yield legacy; } });
    const { getArchiveCached } = await import("./answers-archive-cache");
    const pending = getArchiveCached();
    await started;
    admit(() => []);
    expect(await getArchiveCached()).toEqual([]);
    release({ info: { network: "eip155:5042002" }, async *iterateRecentQueries() { yield historical; } });
    expect(await pending).toEqual([]);
  });

  it.each(["scan", "publication", "missing port", "unexpected identity", "duplicate identity"])("fails closed on %s failure without a partial result", async failure => {
    const value = run("candidate");
    admit(query => {
      if (failure === "scan" && query.before || failure === "publication" && query.ids) throw Error("Publication authority unavailable");
      if (query.ids && failure === "unexpected identity") return [value, run("unexpected")];
      if (query.ids && failure === "duplicate identity") return [value, value];
      return query.before ? [] : [value];
    });
    if (failure === "missing port") fixtures.db.mockResolvedValue({ runPrivacyActive: true });
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect(await getArchiveCached()).toEqual([]);
    expect(fixtures.archive).not.toHaveBeenCalled();
  });

  it("bounds both scan and final publication pages while retaining only slim winners", async () => {
    const rows = Array.from({ length: 75 }, (_, i) => run(`run${String(i).padStart(3, "0")}`, `Question ${i}?`));
    const list = vi.fn(listing(rows)); admit(list);
    const { getArchiveCached } = await import("./answers-archive-cache");
    expect(await getArchiveCached()).toHaveLength(75);
    expect(list.mock.calls.every(([query]) => query.take <= 32 && (!query.ids || query.ids.length <= 32))).toBe(true);
    expect(list.mock.calls.filter(([query]) => query.ids)).toHaveLength(3);
  });

  it("consumes the real SQLite public projection and excludes a tombstone created after selection", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { randomUUID } = await import("node:crypto");
    const { installSqliteApplicationSchema } = await import("./db/sqlite-application-schema");
    const { writeSqliteQueryRun } = await import("./db/query-run-record");
    const { createSqliteRunPrivacy, RUN_PRIVACY_SQL } = await import("./db/run-privacy-sqlite");
    const connection = new DatabaseSync(":memory:");
    try {
      installSqliteApplicationSchema(connection); connection.exec(RUN_PRIVACY_SQL);
      const wallet = `0x${"a".repeat(40)}`, sessionHash = "a".repeat(64), now = Date.now();
      const actor = { wallet, sessionHash, binding: { network: "eip155:5042002" as const, origin: "https://synthetic-archive.example" } };
      connection.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sessionHash, wallet, now - 1000, now + 60000);
      const store = createSqliteRunPrivacy(connection);
      for (const id of ["public", "private", "unlisted"]) writeSqliteQueryRun(connection, { ...run(id, undefined, id !== "public"), asker: wallet }, false);
      await store.change("public", actor, { visibility: "public", revision: 0, requestId: randomUUID() });
      await store.change("unlisted", actor, { visibility: "unlisted", revision: 0, requestId: randomUUID() });
      admit(query => store.list(query));
      const { getArchiveCached } = await import("./answers-archive-cache");
      expect((await getArchiveCached()).map(row => row.id)).toEqual(["public"]);
      let erased = false;
      admit(async query => {
        const rows = await store.list(query);
        if (!query.ids && !erased) { erased = true; await store.erase("public", actor, { revision: 1, requestId: randomUUID() }); }
        return rows;
      });
      expect(await getArchiveCached()).toEqual([]);
      expect((await store.read("public")).exists).toBe(true);
      expect((await store.read("public")).item).toBeNull();
    } finally { connection.close(); }
  });
});
