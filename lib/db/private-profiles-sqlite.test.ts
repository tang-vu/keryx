import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createSqlitePrivateProfiles } from "./private-profiles-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { SqliteAdapter } from "./sqlite-adapter";
const connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [];
afterEach(() => { for (const db of connections.splice(0)) db.close(); for (const db of adapters.splice(0)) db.close(); });
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, creator = `0x${"c".repeat(40)}`;
const input = { displayName: "<script>text</script>", handle: "reader_01", bio: "Reader", purpose: "Papers", links: [{ kind: "github" as const, url: "https://github.com/alice" }] };
function fixture() { const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); return { db, port: createSqlitePrivateProfiles(db) }; }
describe("SQLite private profile domain", () => {
  it("ordinary initialized adapter exposes only a non-enumerable private port", async () => { const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); expect(adapter.privateProfiles).toBeUndefined(); await adapter.init(); expect(adapter.privateProfiles).toBeDefined(); expect(Object.keys(adapter)).not.toContain("privateProfiles"); });
  it("unknown optional profile schema stays disabled while ordinary account/source reads remain available", async () => { const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); (Reflect.get(adapter, "db") as DatabaseSync).exec("CREATE TABLE private_profiles(unknown TEXT)"); await adapter.init(); expect(adapter.privateProfiles).toBeUndefined(); expect(await adapter.listSources()).toEqual([]); expect(await adapter.getUser(alice)).toBeNull(); });
  it("raw helper and a previously ordinary port cannot acquire an enrolled domain", async () => { const { db, port } = fixture(); db.exec("CREATE TABLE keryx_storage_identity(id TEXT)"); const before = db.prepare("SELECT * FROM private_profiles").all(); expect(() => createSqlitePrivateProfiles(db)).toThrow("unavailable in enrolled storage"); await expect(port.update(alice, input)).rejects.toThrow("unavailable in enrolled storage"); await expect(port.get(alice, "eip155:5042")).rejects.toThrow("unavailable in enrolled storage"); await expect(port.delete(alice)).rejects.toThrow("unavailable in enrolled storage"); expect(db.prepare("SELECT * FROM private_profiles").all()).toEqual(before); });
  it("unknown table shape or added profile trigger refuses without repair or unrelated history mutation", async () => {
    const { db, port } = fixture(); await port.update(alice, input);
    db.prepare("INSERT INTO query_runs(id,question,data) VALUES(?,?,?)").run("original", "Retained original", "{}");
    db.exec("CREATE TRIGGER profile_adverse_delete AFTER DELETE ON private_profiles BEGIN UPDATE query_runs SET question='rewritten'; END;");
    const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='private_profiles' ORDER BY name").all();
    await expect(port.delete(alice)).rejects.toThrow("profile_unavailable"); await expect(port.update(alice, { ...input, bio: "Changed" })).rejects.toThrow("profile_unavailable");
    expect(() => createSqlitePrivateProfiles(db)).toThrow("profile_unavailable");
    expect(db.prepare("SELECT question FROM query_runs WHERE id='original'").get()?.question).toBe("Retained original");
    expect(db.prepare("SELECT bio FROM private_profiles WHERE wallet=?").get(alice)?.bio).toBe("Reader");
    expect(db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='private_profiles' ORDER BY name").all()).toEqual(schema);
  });
  it("creates, edits and deletes only the owner's fields, never payment/account/history rows", async () => {
    const { db, port } = fixture(); db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(alice, "asker", "0x…", "2026-10-08T00:00:00.000Z", "2026-10-08T00:00:00.000Z");
    db.prepare("INSERT INTO query_runs(id,asker,origin,data) VALUES(?,?,?,?)").run("mine", alice, "web", "{}");
    db.prepare("INSERT INTO query_runs(id,asker,origin,data) VALUES(?,?,?,?)").run("other", bob, "mcp", "{}");
    db.prepare("INSERT INTO query_memories VALUES(?,?,?,?,?)").run("mine", "{}", "[]", '["biology"]', "2026-10-08T00:00:00.000Z");
    db.prepare("INSERT INTO payment_events(id,query_id,payee,kind,network,settled,settlement_status,tx_hash,amount_usdc) VALUES(?,?,?,?,?,?,?,?,?)").run("settled", "mine", creator, "citation", "eip155:5042", 1, "settled", "recorded-circle-id", 0.005);
    for (const [id, state, settled, tx, kind, network] of [["pending", "pending", 0, null, "citation", "eip155:5042"], ["sim", "simulated", 0, null, "citation", "eip155:5042"], ["fee", "settled", 1, "proof", "operating-fee", "eip155:5042"], ["old", "settled", 1, "proof", "citation", "eip155:5042002"]] as const) db.prepare("INSERT INTO payment_events(id,query_id,payee,kind,network,settled,settlement_status,tx_hash,amount_usdc) VALUES(?,?,?,?,?,?,?,?,?)").run(id, "mine", bob, kind, network, settled, state, tx, 0.02);
    const before = JSON.stringify([db.prepare("SELECT * FROM users").all(), db.prepare("SELECT * FROM query_runs").all(), db.prepare("SELECT * FROM payment_events").all()]);
    expect((await port.get(alice, "eip155:5042")).profile).toBeNull(); const created = await port.update(alice.toUpperCase().replace("0X", "0x"), input);
    expect(created.wallet).toBe(alice); expect(created.displayName).toBe(input.displayName); expect((await port.get(bob, "eip155:5042")).profile).toBeNull();
    const edited = await port.update(alice, { ...input, bio: "Updated" }); expect(edited.createdAt).toBe(created.createdAt);
    const mine = await port.get(alice, "eip155:5042"); expect(mine.activity).toMatchObject({ questions: 1, surfacesUsed: ["web"], topics: ["biology"], creatorsPaid: 1 });
    await port.delete(bob); expect((await port.get(alice, "eip155:5042")).profile).not.toBeNull(); await port.delete(alice); await port.delete(alice);
    expect((await port.get(alice, "eip155:5042")).profile).toBeNull(); expect(JSON.stringify([db.prepare("SELECT * FROM users").all(), db.prepare("SELECT * FROM query_runs").all(), db.prepare("SELECT * FROM payment_events").all()])).toBe(before);
  });
  it("competing owners cannot claim a case-insensitive handle; a collision retains the loser's existing fields", async () => { const { port } = fixture(); await port.update(bob, { ...input, handle: "existing" }); const results = await Promise.allSettled([port.update(alice, { ...input, handle: "Shared" }), port.update(bob, { ...input, handle: "SHARED" })]); expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]); expect((await port.get(bob, "eip155:5042")).profile?.handle).toBe("existing"); await port.delete(alice); expect((await port.update(bob, { ...input, handle: "SHARED" })).handle).toBe("shared"); });
  it("activity aggregates the whole attributed store beyond REST page sizes and excludes other/anonymous rows", async () => { const { db, port } = fixture(); const insert = db.prepare("INSERT INTO query_runs(id,asker,origin,data) VALUES(?,?,?,?)"); db.exec("BEGIN"); for (let i = 0; i < 1201; i++) insert.run(`mine-${i}`, alice, "web", "{}"); insert.run("foreign", bob, "mcp", "{}"); insert.run("anonymous", null, "web", "{}"); db.exec("COMMIT"); const result = await port.get(alice, "eip155:5042"); expect(result.activity.questions).toBe(1201); expect(result.activity.firstSeenAt).toBeNull(); expect(result.activity.surfacesUsed).toEqual(["web"]); });
});
