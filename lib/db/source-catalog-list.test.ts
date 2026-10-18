import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteAdapter } from "./sqlite-adapter";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "./storage-identity";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { canonicalJson } from "../canonical-json";
import { getRetainedSourceClaimMarker, issueSqliteSourceClaimChallenge, verifySqliteSourceClaim, bindSqliteSourceClaim } from "./public-source-claims";
import { readSqliteSourceRegistryOrigin } from "./source-registry-origin";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const prefix = "keryx:source-claims:v1:", originPrefix = "keryx:source-registry-origin:v1:";
const wallet = `0x${"1".repeat(40)}`, date = "2026-10-10T00:00:00.000Z";
const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
  network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
const authority = { network: "eip155:5042", address: `0x${"3".repeat(40)}`, version: 3, codeHash: `0x${"a".repeat(64)}`, deployBlock: "10" };
const sourceId = (i: number) => `source-${String(i).padStart(3, "0")}`;
const onchainId = (i: number) => `0x${String(i + 1).padStart(64, "0")}`;
let directory: string, base: string, serial = 0;
const open: DatabaseSync[] = [];
function put(db: DatabaseSync, key: string, value: unknown) {
  db.prepare("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES (?,?,?)").run(key,
    typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value), date);
}
function seedSources(db: DatabaseSync, count: number) {
  for (let i = 0; i < count; i++) db.prepare(`INSERT INTO sources(id,name,url,description,rss_url,wallet_address,fetch_price,tags,authors,created_at,active,onchain_id,verified)
    VALUES (?,?,?,?,?,?,0,'[]','[]',?,?,?,1)`).run(sourceId(i), `Synthetic source ${i}`, `https://source-${i}.invalid/`, "Synthetic native catalog fixture", `https://source-${i}.invalid/feed`, wallet,
      new Date(Date.parse(date) + i * 1000).toISOString(), i === 23 ? 0 : 1,
      i === 21 ? onchainId(8).replace("0x", "0X") : i === 22 ? "legacy-not-a-registry-id" : onchainId(i));
}
function legacy(db: DatabaseSync, i: number, historyOnly = false) {
  const input = { wallet, canonicalUrl: `https://source-${i}.invalid/`, rssUrl: `https://source-${i}.invalid/feed`,
    deploymentOrigin: "https://keryx.invalid", network: "eip155:5042002", now: 1_000_000 };
  const challenge = issueSqliteSourceClaimChallenge(db, input);
  const claim = verifySqliteSourceClaim(db, { challengeId: challenge.id, wallet, proofDigest: "b".repeat(64), now: input.now + 1 });
  bindSqliteSourceClaim(db, { claimId: claim.id, wallet, expectedRevision: 1, sourceId: sourceId(i), onchainId: onchainId(i),
    registryAddress: authority.address, now: input.now + 2 });
  db.prepare("DELETE FROM sync_state WHERE key IN (?,?)").run(prefix + `marker:${hash(sourceId(i))}`, prefix + `source:${hash(sourceId(i))}`);
  if (historyOnly) db.prepare("DELETE FROM sync_state WHERE key=?").run(prefix + `claim:${claim.id}`);
}
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "keryx-source-catalog-batch-")); base = join(directory, "base.sqlite");
  const db = new DatabaseSync(base);
  try {
    db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db); installNativeUserDomainSchema(db); seedSources(db, 24);
    put(db, prefix + `marker:${hash(sourceId(0))}`, { sourceId: sourceId(0), claimId: "a".repeat(64) });
    put(db, prefix + `source:${hash(sourceId(0))}`, { sourceId: sourceId(0), claimId: "b".repeat(64) });
    put(db, prefix + `marker:${hash(sourceId(1))}`, "null");
    put(db, prefix + `source:${hash(sourceId(1))}`, { sourceId: sourceId(1), claimId: "b".repeat(64) });
    put(db, prefix + `source:${hash(sourceId(2))}`, { sourceId: sourceId(2), claimId: "c".repeat(64) });
    db.exec("COMMIT");
    legacy(db, 3); legacy(db, 4, true);
    put(db, prefix + "claim:corrupt-linked", { linkedSourceId: sourceId(5) });
    const prior = db.prepare("SELECT value FROM sync_state WHERE key LIKE ? AND json_extract(value,'$.claim.linkedSourceId')=? LIMIT 1")
      .get(prefix + "history:%", sourceId(3));
    const competing = JSON.parse(String(prior!.value));
    put(db, prefix + "history:after-corrupt", { ...competing, claim: { ...competing.claim, linkedSourceId: sourceId(5) } });
    put(db, prefix + "history:corrupt-linked", { claim: { linkedSourceId: sourceId(6) } });
    put(db, prefix + "claim:unrelated-invalid-json", "{");
    put(db, prefix + `marker:${hash(sourceId(7))}`, Buffer.from("null"));
    put(db, prefix + "claim:blob-linked", Buffer.from(JSON.stringify({ linkedSourceId: sourceId(9) })));
    put(db, originPrefix + onchainId(8), { format: "keryx-source-registry-origin-v1", onchainId: onchainId(8), authority });
    // Both retained forms exist for source3; keep the old first-match oracle,
    // rather than introducing a new claim/history preference during batching.
  } finally { db.close(); }
});
afterEach(() => { vi.restoreAllMocks(); for (const db of open.splice(0)) db.close(); vi.unstubAllEnvs(); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function fixture(extra = 0) {
  const file = join(directory, `case-${++serial}.sqlite`); copyFileSync(base, file);
  const raw = new DatabaseSync(file); open.push(raw);
  if (extra) { raw.prepare("DELETE FROM sources").run(); seedSources(raw, extra); }
  const core = SqliteAdapter.assembleConnectionCore(raw, identity, () => {});
  return { file, raw, core };
}

it("preserves complete source-list output against unchanged single-source marker/origin readers", async () => {
  const { raw, core } = fixture();
  const expected = await Promise.all(Array.from({ length: 24 }, (_, i) => core.getSource(sourceId(i))));
  expect(await core.listAllSources()).toEqual(expected);
  expect(await core.listSources()).toEqual(expected.filter(source => source!.active));
  expect(expected[0]?.sourceClaimId).toBe("a".repeat(64));
  for (const i of [1, 5, 6, 7]) expect(expected[i]?.sourceClaimId).toBe(hash(`unavailable-source-claim:${sourceId(i)}`));
  expect(expected[8]?.registryAuthority).toEqual(authority);
  expect(expected[21]?.registryAuthority).toBeUndefined();
  expect(expected[22]?.registryAuthority).toBeUndefined();
  expect(raw.isTransaction).toBe(false);
});

it("bounds metadata statements across multiple batches without dropping retained source or registry fields", async () => {
  const { raw, core } = fixture(101);
  const expected = await Promise.all(Array.from({ length: 101 }, (_, i) => core.getSource(sourceId(i))));
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  expect(await core.listAllSources()).toEqual(expected);
  const metadata = prepare.mock.calls.filter(([sql]) => sql.includes("FROM sync_state"));
  expect(metadata.length).toBeLessThanOrEqual(12);
  expect(raw.isTransaction).toBe(false);
});

it("keeps caller transactions owned and sees metadata changes on the next list", async () => {
  const { raw, core } = fixture(); raw.exec("BEGIN");
  expect((await core.listSources())[0].sourceClaimId).toBe("a".repeat(64)); expect(raw.isTransaction).toBe(true);
  put(raw, prefix + `marker:${hash(sourceId(0))}`, { sourceId: sourceId(0), claimId: "d".repeat(64) });
  expect((await core.listSources())[0].sourceClaimId).toBe("d".repeat(64)); expect(raw.isTransaction).toBe(true);
  raw.exec("ROLLBACK"); expect((await core.listSources())[0].sourceClaimId).toBe("a".repeat(64));
});

it("keeps source rows and retained metadata in one WAL snapshot, then reads the next revision freshly", async () => {
  const { file, raw, core } = fixture(); raw.exec("PRAGMA journal_mode=WAL");
  const writer = new DatabaseSync(file), originalPrepare = DatabaseSync.prototype.prepare;
  let changed = false;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
    const statement = Reflect.apply(originalPrepare, this, [sql]);
    if (this !== raw || !sql.startsWith("SELECT * FROM sources")) return statement;
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "all") return (...args: unknown[]) => {
        const rows = Reflect.apply(target.all, target, args);
        if (!changed) {
          changed = true; writer.exec("BEGIN IMMEDIATE");
          writer.prepare("UPDATE sources SET name='New source revision' WHERE id=?").run(sourceId(0));
          put(writer, prefix + `marker:${hash(sourceId(0))}`, { sourceId: sourceId(0), claimId: "e".repeat(64) });
          writer.exec("COMMIT");
        }
        return rows;
      };
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    const first = (await core.listSources())[0];
    expect(changed).toBe(true); expect(first.name).toBe("Synthetic source 0"); expect(first.sourceClaimId).toBe("a".repeat(64));
    const second = (await core.listSources())[0];
    expect(second.name).toBe("New source revision"); expect(second.sourceClaimId).toBe("e".repeat(64));
  } finally { writer.close(); }
});

it("does not inspect inactive origins on the active list, while all-sources keeps their refusal", async () => {
  const { raw, core } = fixture(); put(raw, originPrefix + onchainId(23), "{}");
  expect(await core.listSources()).toHaveLength(23);
  await expect(core.listAllSources()).rejects.toThrow(); expect(raw.isTransaction).toBe(false);
});

it.each(["wrong-id", "extra-key", "blob"])("preserves strict %s origin refusal and rolls back its own list snapshot", async mutation => {
  const { raw, core } = fixture();
  const value = { format: "keryx-source-registry-origin-v1", onchainId: onchainId(8), authority };
  put(raw, originPrefix + onchainId(8), mutation === "blob" ? Buffer.from(JSON.stringify(value))
    : mutation === "wrong-id" ? { ...value, onchainId: onchainId(9) } : { ...value, untrusted: true });
  expect(() => readSqliteSourceRegistryOrigin(raw, onchainId(8))).toThrow();
  await expect(core.listSources()).rejects.toThrow(); expect(raw.isTransaction).toBe(false);
});

it("genuine enrolled readonly list keeps originals unchanged and fresh schema drift refused", async () => {
  const { file, raw } = fixture(); insertStorageIdentity(raw, identity); installStorageFences(raw, identity);
  const manifest = join(directory, `deployment-${serial}.json`);
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file); vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", "11".repeat(32)); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  const { createReadonlyEnrolledSqliteAdapter } = await import("./enrolled-sqlite-adapter");
  const before = readFileSync(file), reader = await createReadonlyEnrolledSqliteAdapter();
  try {
    const sources = await reader.listSources(); expect(sources).toHaveLength(23);
    expect(sources[0].sourceClaimId).toBe(getRetainedSourceClaimMarker(raw, sourceId(0)));
    expect(sources[8].registryAuthority).toEqual(authority); expect(readFileSync(file)).toEqual(before);
    raw.exec("CREATE INDEX synthetic_catalog_drift ON sources(name)");
    expect(() => reader.listSources()).toThrow();
  } finally { reader.close(); }
}, 30_000);
