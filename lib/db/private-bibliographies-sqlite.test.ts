import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { createSqlitePrivateBibliographies } from "./private-bibliographies-sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { PAPER_CATALOG } from "../papers/catalog";
import { paperReferencesBibtex } from "../papers/reference-export";
import { requirePrivateBibliographies } from "../bibliographies/private-bibliography";
import type { KeryxDB } from "./keryx-db";
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const input = { title: "Private review name", papers: [PAPER_CATALOG[0]] };
const connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [];
afterEach(() => { connections.splice(0).forEach(db => db.close()); adapters.splice(0).forEach(db => db.close()); });
function fixture() { const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); return { db, port: createSqlitePrivateBibliographies(db) }; }
describe("ordinary private bibliography snapshots", () => {
  it("only initialized ordinary SQLite exposes the non-enumerable optional port", async () => {
    const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter);
    expect(adapter.privateBibliographies).toBeUndefined(); await adapter.init(); expect(adapter.privateBibliographies).toBeDefined();
    expect(Object.keys(adapter)).not.toContain("privateBibliographies");
    expect(() => requirePrivateBibliographies({} as KeryxDB)).toThrow("bibliography_unavailable");
  });
  it("unknown optional schema disables only this domain and is not repaired", async () => {
    const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter);
    const db = Reflect.get(adapter, "db") as DatabaseSync; db.exec("CREATE TABLE private_bibliographies(unknown TEXT)");
    await adapter.init(); expect(adapter.privateBibliographies).toBeUndefined(); expect(await adapter.listSources()).toEqual([]);
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='private_bibliographies'").get()?.sql).toBe("CREATE TABLE private_bibliographies(unknown TEXT)");
  });
  it("stores hashes only and lists no secret or published content; owner titles never enter the file", async () => {
    const { db, port } = fixture(), created = await port.create(alice, input);
    expect(created.token).toMatch(/^[0-9a-f]{64}$/); expect(created.bibliography).toMatchObject({ count: 1, revision: 1, title: input.title });
    expect(await port.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
    expect((await port.read(created.token))?.content).not.toContain(input.title);
    expect(await port.list(bob)).toEqual([]); expect(await port.list(alice.toUpperCase().replace("0X", "0x"))).toEqual([created.bibliography]);
    const persisted = JSON.stringify(db.prepare("SELECT * FROM private_bibliographies").all());
    expect(persisted).not.toContain(created.token); expect(persisted).toContain("token_hash");
    expect(JSON.stringify(await port.list(alice))).not.toMatch(/token|content|wallet/);
    expect(await port.read("0".repeat(64))).toBeNull();
  });
  it("replaces one owner's snapshot under the same token and refuses stale or foreign updates and revocations", async () => {
    const { port } = fixture(), { bibliography: original, token } = await port.create(alice, input);
    await expect(port.replace(bob, original.id, input, 1)).rejects.toThrow("bibliography_not_found");
    await expect(port.revoke(bob, original.id, 1)).rejects.toThrow("bibliography_not_found");
    const updated = await port.replace(alice, original.id, { title: "Renamed private review", papers: [] }, 1);
    expect(updated).toMatchObject({ id: original.id, count: 0, revision: 2, createdAt: original.createdAt });
    expect(await port.read(token)).toEqual({ content: "" });
    await expect(port.replace(alice, original.id, input, 1)).rejects.toThrow("bibliography_conflict");
    await expect(port.revoke(alice, original.id, 1)).rejects.toThrow("bibliography_conflict");
    expect(await port.list(alice)).toEqual([updated]);
    await port.revoke(alice, original.id, 2); expect(await port.read(token)).toBeNull(); expect(await port.list(alice)).toEqual([]);
    const replacement = await port.create(alice, input); expect(replacement.token).not.toBe(token);
  });
  it("concurrent same-revision replacements admit one, while retaining exact reference keys", async () => {
    const { port } = fixture(), created = await port.create(alice, { ...input, papers: PAPER_CATALOG.slice(0, 2) });
    const results = await Promise.allSettled([port.replace(alice, created.bibliography.id, input, 1), port.replace(alice, created.bibliography.id, { ...input, papers: [] }, 1)]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(await port.read(created.token)).toEqual({ content: paperReferencesBibtex(input.papers).content });
  });
  it("refuses malformed, duplicate and oversized metadata without changing a snapshot", async () => {
    const { db, port } = fixture(), created = await port.create(alice, input), before = JSON.stringify(db.prepare("SELECT * FROM private_bibliographies").all());
    for (const invalid of [{ ...input, question: "private" }, { ...input, papers: [{ ...input.papers[0], notes: "private" }] }, { ...input, papers: [...input.papers, ...input.papers] }])
      await expect(port.replace(alice, created.bibliography.id, invalid as never, 1)).rejects.toThrow();
    const oversized = Array.from({ length: 50 }, (_, index) => ({ ...PAPER_CATALOG[0], arxivId: `1706.03762v${index + 1}`, url: `https://arxiv.org/abs/1706.03762v${index + 1}`,
      metadataUrl: `https://export.arxiv.org/api/query?id_list=1706.03762v${index + 1}`, authors: Array.from({ length: 50 }, () => "A".repeat(300)), authorCount: 50, authorsTruncated: false }));
    await expect(port.replace(alice, created.bibliography.id, { ...input, papers: oversized }, 1)).rejects.toThrow("bibliography_limit");
    expect(JSON.stringify(db.prepare("SELECT * FROM private_bibliographies").all())).toBe(before);
  });
  it("caps each owner independently without overshooting concurrent creates", async () => {
    const { port } = fixture(), results = await Promise.allSettled(Array.from({ length: 21 }, () => port.create(alice, { ...input, papers: [] })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(20);
    expect(await port.list(alice)).toHaveLength(20); await expect(port.create(bob, input)).resolves.toBeDefined();
  });
  it("an enrolled marker invalidates both new helpers and previously ordinary ports before I/O", async () => {
    const { db, port } = fixture(), created = await port.create(alice, input);
    db.exec("CREATE TABLE keryx_storage_identity(id TEXT)"); const before = JSON.stringify(db.prepare("SELECT * FROM private_bibliographies").all());
    expect(() => createSqlitePrivateBibliographies(db)).toThrow("unavailable in enrolled storage");
    for (const operation of [() => port.list(alice), () => port.read(created.token), () => port.create(alice, input), () => port.replace(alice, created.bibliography.id, input, 1), () => port.revoke(alice, created.bibliography.id, 1)])
      await expect(operation()).rejects.toThrow("unavailable in enrolled storage");
    expect(JSON.stringify(db.prepare("SELECT * FROM private_bibliographies").all())).toBe(before);
  });
  it("refuses added triggers without rewriting unrelated original history", async () => {
    const { db, port } = fixture(), created = await port.create(alice, input);
    db.prepare("INSERT INTO query_runs(id,question,data) VALUES(?,?,?)").run("original", "Original retained", "{}");
    db.exec("CREATE TRIGGER bib_adverse_delete AFTER DELETE ON private_bibliographies BEGIN UPDATE query_runs SET question='changed'; END;");
    await expect(port.revoke(alice, created.bibliography.id, 1)).rejects.toThrow("bibliography_unavailable");
    await expect(port.read(created.token)).rejects.toThrow("bibliography_unavailable");
    expect(db.prepare("SELECT question FROM query_runs WHERE id='original'").get()?.question).toBe("Original retained");
  });
});
