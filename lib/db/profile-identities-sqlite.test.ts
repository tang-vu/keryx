import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSqlitePrivateProfiles } from "./private-profiles-sqlite";
import { createSqliteProfileIdentities } from "./profile-identities-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { SqliteAdapter } from "./sqlite-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { requireProfileIdentities, type IdentityChallenge, type ProviderIdentity } from "../profiles/verified-identities";

const connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [], directories: string[] = [];
afterEach(() => {
  for (const db of connections.splice(0)) db.close();
  for (const adapter of adapters.splice(0)) adapter.close();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes("keryx-profile-identities-")) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
const profile = { displayName: "Alice", handle: "", bio: "Reader", purpose: "Papers", links: [] };
const hash = (name: string) => createHash("sha256").update(name).digest("hex");
const github: ProviderIdentity = { provider: "github", externalId: "12345", label: "Alice" };
const orcid: ProviderIdentity = { provider: "orcid", externalId: "0000-0002-1825-0097", label: "Alice Researcher" };
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "keryx-profile-identities-")); directories.push(directory);
  const path = join(directory, "ordinary.sqlite"), db = new DatabaseSync(path); connections.push(db);
  installSqliteApplicationSchema(db); const profiles = createSqlitePrivateProfiles(db);
  let now = Date.parse("2026-10-09T00:00:00.000Z");
  const port = createSqliteProfileIdentities(db, { fixtureClock: () => now });
  for (const wallet of [alice, bob]) {
    await profiles.update(wallet, profile);
    db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
      .run(hash(wallet), wallet, now - 10_000, now + 3_600_000);
  }
  const challenge = (name: string, wallet = alice, provider: IdentityChallenge["provider"] = "github"): IdentityChallenge => ({
    wallet, provider, stateHash: hash(name), sessionHash: hash(wallet), expiresAt: new Date(now + 600_000).toISOString(),
  });
  const verify = async (value: IdentityChallenge, identity = github) => { await port.begin(value); await port.consume(value); return port.complete(value, identity); };
  return { db, path, profiles, port, challenge, verify, setNow: (value: number) => { now = value; }, getNow: () => now };
}
describe("ordinary SQLite private verified identity persistence", () => {
  it("installs only after private profile admission, as a nonenumerable optional adapter port", async () => {
    const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter);
    expect(adapter.profileIdentities).toBeUndefined(); await adapter.init();
    expect(adapter.profileIdentities).toBeDefined(); expect(Object.keys(adapter)).not.toContain("profileIdentities");
    const unavailable = new SqliteAdapter(":memory:"); adapters.push(unavailable);
    (Reflect.get(unavailable, "db") as DatabaseSync).exec("CREATE TABLE private_profiles(unknown TEXT)");
    await unavailable.init(); expect(unavailable.privateProfiles).toBeUndefined(); expect(unavailable.profileIdentities).toBeUndefined();
  });
  it("lists only the owner and retains verification during a replacement, with no secrets stored", async () => {
    const f = await fixture(), initial = f.challenge("initial");
    expect(await f.port.list(alice)).toEqual({ wallet: alice, identities: [] });
    const record = await f.verify(initial); expect(record).toEqual({ wallet: alice, ...github, verifiedAt: "2026-10-09T00:00:00.000Z" });
    const replacement = f.challenge("replacement"); await f.port.begin(replacement);
    expect((await f.port.list(alice)).identities).toEqual([record]); expect((await f.port.list(bob)).identities).toEqual([]);
    await f.port.consume(replacement); await f.port.complete(replacement, { ...github, externalId: "67890", label: "Alice-new" });
    const second = f.challenge("orcid", alice, "orcid"); await f.verify(second, orcid);
    expect((await f.port.list(alice.toUpperCase().replace("0X", "0x"))).identities).toHaveLength(2);
    expect(Object.keys(f.db.prepare("SELECT * FROM profile_identity_challenges LIMIT 1").get()!))
      .toEqual(["state_hash", "wallet", "provider", "session_hash", "expires_at", "status"]);
  });
  it("enforces single consume and single successful complete, including identical begin replay", async () => {
    const f = await fixture(), c = f.challenge("single"); await f.port.begin(c);
    await expect(f.port.complete(c, github)).rejects.toThrow("identity_expired");
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    await f.port.consume(c); await expect(f.port.consume(c)).rejects.toThrow("identity_expired");
    await f.port.complete(c, github); await expect(f.port.complete(c, github)).rejects.toThrow("identity_expired");
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
  });
  it("bounds retained challenge state to one current row per wallet/provider", async () => {
    const f = await fixture(), first = f.challenge("old-consumed"); await f.port.begin(first); await f.port.consume(first);
    for (let i = 0; i < 40; i++) {
      const c = f.challenge(`bounded-${i}`); await f.port.begin(c); if (i % 2) await f.port.consume(c);
      expect(f.db.prepare("SELECT count(*) AS n FROM profile_identity_challenges WHERE wallet=? AND provider='github'").get(alice)?.n).toBe(1);
    }
    await expect(f.port.complete(first, github)).rejects.toThrow("identity_expired");
    await f.port.begin(f.challenge("bounded-orcid", alice, "orcid"));
    expect(f.db.prepare("SELECT count(*) AS n FROM profile_identity_challenges WHERE wallet=?").get(alice)?.n).toBe(2);
  });
  it("atomically enforces global provider identity uniqueness and retains the loser's old verification", async () => {
    const f = await fixture(); await f.verify(f.challenge("alice"));
    const old = await f.verify(f.challenge("bob", bob), { ...github, externalId: "99999", label: "Bob" });
    const c = f.challenge("bob-replacement", bob); await f.port.begin(c); await f.port.consume(c);
    await expect(f.port.complete(c, github)).rejects.toThrow("identity_conflict");
    expect((await f.port.list(bob)).identities).toEqual([old]);
    await f.port.unlink(alice, "github"); await f.port.complete(c, github);
    expect((await f.port.list(bob)).identities[0].externalId).toBe(github.externalId);
  });
  it("requires the saved profile and an active durable session of the exact wallet at begin", async () => {
    const f = await fixture(), c = f.challenge("required"); await f.profiles.delete(alice);
    await expect(f.port.begin(c)).rejects.toThrow("profile_required"); await f.profiles.update(alice, profile);
    for (const sessionHash of [hash("missing"), hash(bob)]) await expect(f.port.begin({ ...c, sessionHash })).rejects.toThrow("identity_expired");
    f.db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?").run(f.getNow() + 1, f.getNow() + 600_001, c.sessionHash);
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    f.db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?").run(f.getNow() - 1000, f.getNow(), c.sessionHash);
    await expect(f.port.begin(c)).rejects.toThrow("identity_expired");
    expect(f.db.prepare("SELECT count(*) AS n FROM profile_identity_challenges").get()?.n).toBe(0);
  });
  it("rejects wrong wallet/session/provider/state/deadline before consuming the original challenge", async () => {
    const f = await fixture(), c = f.challenge("bound"); await f.port.begin(c);
    for (const changed of [{ wallet: bob, sessionHash: hash(bob) }, { sessionHash: hash(bob) }, { provider: "orcid" as const },
      { stateHash: hash("other") }, { expiresAt: new Date(Date.parse(c.expiresAt) + 1).toISOString() }])
      await expect(f.port.consume({ ...c, ...changed })).rejects.toThrow("identity_expired");
    await f.port.consume(c); await expect(f.port.complete(c, orcid)).rejects.toThrow("identity_expired");
    await f.port.complete(c, github);
  });
  it("checks database time at both consume and complete, and bounds deadline to session expiry", async () => {
    const f = await fixture(), c = f.challenge("expiry");
    await expect(f.port.begin({ ...c, expiresAt: new Date(f.getNow() + 3_600_001).toISOString() })).rejects.toThrow("identity_expired");
    await f.port.begin(c); f.setNow(Date.parse(c.expiresAt)); await expect(f.port.consume(c)).rejects.toThrow("identity_expired");
    const next = f.challenge("expires-after-consume"); await f.port.begin(next); await f.port.consume(next);
    f.setNow(Date.parse(next.expiresAt)); await expect(f.port.complete(next, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities).toEqual([]);
  });
  it("rechecks revocation after begin and after consume, without recording a verification", async () => {
    const f = await fixture(), c = f.challenge("revoked-before-consume"); await f.port.begin(c);
    f.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(c.sessionHash); await expect(f.port.consume(c)).rejects.toThrow("identity_expired");
    f.db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(alice), alice, f.getNow() - 1000, f.getNow() + 3_600_000);
    const next = f.challenge("revoked-after-consume"); await f.port.begin(next); await f.port.consume(next);
    f.db.prepare("DELETE FROM web_sessions WHERE hash=?").run(next.sessionHash); await expect(f.port.complete(next, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities).toEqual([]);
  });
  it.each(["unlink", "profile-delete", "replace-start"])("invalidates consumed in-flight completion on %s", async action => {
    const f = await fixture(), c = f.challenge("in-flight"); await f.port.begin(c); await f.port.consume(c);
    if (action === "unlink") await f.port.unlink(alice, "github");
    if (action === "profile-delete") { await f.profiles.delete(alice); await f.profiles.update(alice, profile); }
    if (action === "replace-start") await f.port.begin(f.challenge("new-start"));
    await expect(f.port.complete(c, github)).rejects.toThrow("identity_expired");
    expect((await f.port.list(alice)).identities).toEqual([]);
    if (action !== "replace-start") expect(f.db.prepare("SELECT count(*) AS n FROM profile_identity_challenges").get()?.n).toBe(0);
  });
  it("a second ordinary connection cannot complete an invalidated lineage or claim an already-owned external ID", async () => {
    const f = await fixture(), db2 = new DatabaseSync(f.path); connections.push(db2);
    const second = createSqliteProfileIdentities(db2, { fixtureClock: f.getNow });
    const c = f.challenge("connection"); await f.port.begin(c); await second.consume(c); await f.port.unlink(alice, "github");
    await expect(second.complete(c, github)).rejects.toThrow("identity_expired");
    await f.verify(f.challenge("alice-winner")); const bobChallenge = f.challenge("bob-loser", bob);
    await second.begin(bobChallenge); await second.consume(bobChallenge); await expect(second.complete(bobChallenge, github)).rejects.toThrow("identity_conflict");
  });
  it("sealed cores expose no port; pre-existing ordinary ports refuse enrollment before domain reads/writes", async () => {
    const f = await fixture(); const core = SqliteAdapter.assembleConnectionCore(f.db, syntheticStorageIdentity("testnet-offline"), () => {});
    expect(Object.hasOwn(core, "profileIdentities")).toBe(false); expect(() => requireProfileIdentities(core)).toThrow("identity_unavailable");
    f.db.exec("CREATE TABLE keryx_storage_identity(id TEXT)"); const before = f.db.prepare("SELECT * FROM profile_identity_challenges").all();
    expect(() => createSqliteProfileIdentities(f.db)).toThrow("identity_unavailable");
    await expect(f.port.list(alice)).rejects.toThrow("identity_unavailable"); await expect(f.port.begin(f.challenge("sealed"))).rejects.toThrow("identity_unavailable");
    expect(f.db.prepare("SELECT * FROM profile_identity_challenges").all()).toEqual(before);
  });
  it.each(["profile_verified_identities", "profile_identity_challenges", "web_sessions"])("refuses changed %s schema before every operation and does not repair it", async table => {
    const f = await fixture(), c = f.challenge("shape"); await f.port.begin(c); await f.port.consume(c);
    f.db.exec(`CREATE TRIGGER adverse_identity AFTER DELETE ON ${table} BEGIN DELETE FROM private_profiles; END;`);
    const before = f.db.prepare("SELECT * FROM private_profiles").all(), schema = f.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all();
    for (const call of [() => f.port.list(alice), () => f.port.begin(f.challenge("changed")), () => f.port.consume(c),
      () => f.port.complete(c, github), () => f.port.unlink(alice, "github")]) await expect(call()).rejects.toThrow("identity_unavailable");
    expect(() => createSqliteProfileIdentities(f.db)).toThrow("identity_unavailable");
    expect(f.db.prepare("SELECT * FROM private_profiles").all()).toEqual(before); expect(f.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
  });
  it("malformed optional tables disable only this domain and disabled foreign keys refuse", async () => {
    const adapter = new SqliteAdapter(":memory:"); adapters.push(adapter); const db = Reflect.get(adapter, "db") as DatabaseSync;
    db.exec("CREATE TABLE profile_identity_challenges(unknown TEXT)"); await adapter.init();
    expect(adapter.privateProfiles).toBeDefined(); expect(adapter.profileIdentities).toBeUndefined(); expect(await adapter.listSources()).toEqual([]);
    const f = await fixture(); f.db.exec("PRAGMA foreign_keys=OFF"); await expect(f.port.begin(f.challenge("fk-off"))).rejects.toThrow("identity_unavailable");
  });
});
