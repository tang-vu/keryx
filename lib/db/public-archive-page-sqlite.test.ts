import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildArchive } from "../answers-archive";
import type { QueryRun } from "../types";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { writeSqliteQueryRun } from "./query-run-record";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "./run-privacy-sqlite";

let db: DatabaseSync, store: ReturnType<typeof createSqliteRunPrivacy>;
const wallet = `0x${"a".repeat(40)}`;
const actor = { wallet, sessionHash: "a".repeat(64), binding: { network: "eip155:5042002" as const, origin: "https://archive-fixture.example" } };
function run(id: string, over: Partial<QueryRun> = {}): QueryRun {
  return { id, asker: wallet, question: `${id} question`, answer: `${id} original answer`, createdAt: "2026-10-12T00:00:00.000Z",
    engine: "fixture", budget: 0, totalSpent: 0.01, totalToCreators: 0.005, subClaims: [], decisions: [], trace: [],
    citations: [{ marker: "S1", sourceId: "source", sourceName: "Fixture", weight: 1, reward: 0.005, rationale: "" }], ...over };
}
async function save(value: QueryRun, visibility: "public" | "private" | "unlisted" = "public") {
  writeSqliteQueryRun(db, value, false);
  if (visibility !== "private") await store.change(value.id, actor, { visibility, revision: 0, requestId: randomUUID() });
}
beforeEach(() => {
  db = new DatabaseSync(":memory:"); installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL); store = createSqliteRunPrivacy(db);
  const now = Date.now(); db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(actor.sessionHash, wallet, now - 1000, now + 60000);
});
afterEach(() => { vi.restoreAllMocks(); if (db.isOpen) db.close(); });

it("retains exact public ordering, keysets, parents, ID filters and empty-answer window rows", async () => {
  for (const value of [run("a"), run("b", { parentId: "a" }), run("c", { answer: "" }), run("hidden"), run("link")]) {
    await save(value, value.id === "hidden" ? "private" : value.id === "link" ? "unlisted" : "public");
  }
  for (const query of [{ take: 2 }, { take: 10, before: { id: "c", createdAt: run("c").createdAt } },
    { take: 10, parentId: "a" }, { take: 10, ids: ["a", "c", "hidden", "link"] }]) {
    const full = await store.list(query), slim = await store.archivePage!(query);
    expect(slim.map(row => row.id)).toEqual(full.map(row => row.id));
    for (let i = 0; i < full.length; i++) expect(slim[i].entry).toEqual(buildArchive([full[i]])[0] ?? null);
  }
  expect((await store.archivePage!({ take: 1 }))[0]).toMatchObject({ id: "c", entry: null });
});

it("reuses only a bounded card and validates changed original bytes including language evidence", async () => {
  const value = run("current");
  value.trace = [{ phase: "done", ts: 0, message: "Synthetic terminal provenance", detail: { answerLanguage: {
    format: "keryx-answer-language-v1", scope: "generated-prose", language: "vi", method: "deterministic-renderer",
    answerSha256: `0x${createHash("sha256").update(value.answer).digest("hex")}` } } }];
  await save(value);
  const parse = vi.spyOn(JSON, "parse");
  const first = (await store.archivePage!({ take: 10 }))[0];
  expect(first.entry?.answerLanguage).toBe("vi");
  const originalParses = () => parse.mock.calls.filter(([text]) => typeof text === "string" && text.includes('"id":"current"') && text.includes('"trace":')).length;
  expect(originalParses()).toBe(1);
  first.entry!.sourceNames.push("Poison"); first.entry!.answerSnippet = "Poison";
  expect((await store.archivePage!({ take: 10 }))[0].entry).toEqual(buildArchive([value])[0]);
  expect(originalParses()).toBe(1);
  const changed = { ...value, answer: "Changed original, not covered by earlier language evidence" };
  db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(JSON.stringify(changed), value.id);
  const fresh = (await store.archivePage!({ take: 10 }))[0];
  expect(fresh.entry?.answerLanguage).toBe("und"); expect(fresh.entry?.answerSnippet).toBe(changed.answer);
  expect(originalParses()).toBe(2);
  expect(JSON.stringify(fresh)).not.toMatch(/trace|answerSha256|Synthetic terminal/);
});

it("filters revoked and erased cached originals before retrieval, and refuses unavailable schema", async () => {
  await save(run("revoked")); await save(run("erased"));
  await store.archivePage!({ take: 10 });
  await store.change("revoked", actor, { visibility: "private", revision: 1, requestId: randomUUID() });
  await store.erase("erased", actor, { revision: 1, requestId: randomUUID() });
  const parse = vi.spyOn(JSON, "parse");
  expect(await store.archivePage!({ take: 10 })).toEqual([]);
  expect(parse.mock.calls.some(([text]) => typeof text === "string" && /original answer/.test(text))).toBe(false);
  db.exec("DROP TRIGGER run_privacy_new");
  await expect(store.archivePage!({ take: 10 })).rejects.toThrow("privacy_unavailable");
});

it("fails closed on corrupt cached originals and metadata mismatches", async () => {
  await save(run("corrupt")); await store.archivePage!({ take: 10 });
  for (const data of ['{}', JSON.stringify(run("other")), JSON.stringify(run("corrupt", { createdAt: "different" }))]) {
    db.prepare("UPDATE query_runs SET data=? WHERE id='corrupt'").run(data);
    await expect(store.archivePage!({ take: 10 })).rejects.toThrow();
  }
  db.close(); await expect(store.archivePage!({ take: 10 })).rejects.toThrow();
});

it("does not retain oversized cards or accept an original above the existing validation limit", async () => {
  await save(run("large", { question: "q".repeat(70_000) }));
  const parse = vi.spyOn(JSON, "parse");
  await store.archivePage!({ take: 1 }); await store.archivePage!({ take: 1 });
  expect(parse.mock.calls.filter(([text]) => typeof text === "string" && text.includes('"id":"large"') && text.includes('"trace":'))).toHaveLength(2);
  db.prepare("UPDATE query_runs SET data=? WHERE id='large'").run(JSON.stringify(run("large", { answer: "x".repeat(4_000_001) })));
  await expect(store.archivePage!({ take: 1 })).rejects.toThrow("privacy_unavailable");
});

it("evicts old cards when retained text reaches the connection's memory budget", async () => {
  db.prepare("INSERT INTO run_privacy_defaults VALUES(?, 'public')").run(wallet);
  for (let i = 0; i < 140; i++) writeSqliteQueryRun(db, run(`bounded${String(i).padStart(3, "0")}`, { question: "q".repeat(62_000) }), false);
  let before: { id: string; createdAt: string } | undefined;
  for (;;) {
    const page = await store.archivePage!({ take: 32, before });
    if (!page.length) break;
    before = { id: page.at(-1)!.id, createdAt: page.at(-1)!.createdAt };
  }
  const parse = vi.spyOn(JSON, "parse");
  expect((await store.archivePage!({ ids: ["bounded139"], take: 1 }))[0].entry?.question).toHaveLength(62_000);
  expect(parse.mock.calls.filter(([text]) => typeof text === "string" && text.includes('"id":"bounded139"') && text.includes('"trace":'))).toHaveLength(1);
});
