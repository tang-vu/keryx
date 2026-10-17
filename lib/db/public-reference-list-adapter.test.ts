import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { canonicalJson } from "../canonical-json";
import { publicReferenceItemId, type PublicReference } from "../public-references/catalog";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { readSqlitePublicReference, upsertSqlitePublicReference } from "./public-reference-archive";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import type { SqliteAdapter } from "./sqlite-adapter";

const fixtures: { folder: string; seed: DatabaseSync; adapter?: SqliteAdapter }[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) {
    fixture.adapter?.close(); fixture.seed.close();
    if (dirname(resolve(fixture.folder)) !== resolve(tmpdir()) || !basename(fixture.folder).startsWith("keryx-list-adapter-"))
      throw new Error("Synthetic fixture escaped its owned temporary directory");
    rmSync(fixture.folder, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});
function publisher(id: string, count = 0, active = true): PublicReference {
  const referenceId = `public:${id}`;
  return { id: referenceId, name: id, url: `https://${id}.example/`, rssUrl: `https://${id}.example/feed`,
    description: "Synthetic public publisher", tags: [], active,
    items: Array.from({ length: count }, (_, n) => {
      const link = `https://${id}.example/${n}`;
      return { id: publicReferenceItemId(referenceId, link), link, title: `Article ${n}`, summary: "Retained excerpt",
        content: "Synthetic public excerpt.", publishedAt: "2026-10-17T00:00:00.000Z", deliveryKind: "excerpt" as const };
    }) };
}
async function fixture(archive: boolean, references = [publisher("zeta", 12), publisher("alpha", 1), publisher("hidden", 2, false)], corruptActive = false) {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-list-adapter-")), file = join(folder, "synthetic.sqlite");
  const manifest = join(folder, "deployment.json"), seed = new DatabaseSync(file);
  const owned: (typeof fixtures)[number] = { folder, seed }; fixtures.push(owned);
  const identity: StorageIdentity = { ...syntheticStorageIdentity("testnet-real"), format: "keryx-mainnet-storage-identity-v1",
    authorityMode: "mainnet-real", network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  seed.exec("BEGIN IMMEDIATE");
  try {
    installMainnetApplicationSchema(seed, { publicReferenceArchive: archive });
    for (const reference of references) {
      if (archive) upsertSqlitePublicReference(seed, reference);
      else seed.prepare("INSERT INTO public_references(id,active,rss_url,snapshot) VALUES(?,?,?,?)")
        .run(reference.id, Number(reference.active), reference.rssUrl, JSON.stringify(reference));
    }
    // Inactive corrupt content must never be parsed by the public list.
    seed.prepare("UPDATE public_references SET snapshot='invalid hidden JSON' WHERE active=0").run();
    if (corruptActive) seed.prepare("UPDATE public_references SET snapshot='{}' WHERE id='public:alpha'").run();
    insertStorageIdentity(seed, identity); installStorageFences(seed, identity); seed.exec("COMMIT");
  } catch (error) { if (seed.isTransaction) seed.exec("ROLLBACK"); throw error; }
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"11".repeat(20)}`);
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"11".repeat(20)}`);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "01".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_RUN_CLAIMS_ENABLED", "false");
  const { createReadonlyEnrolledSqliteAdapter } = await import("./enrolled-sqlite-adapter");
  const adapter = await createReadonlyEnrolledSqliteAdapter(); owned.adapter = adapter;
  return { file, seed, adapter };
}
function previousList(db: DatabaseSync) {
  return db.prepare("SELECT id,active,rss_url,snapshot FROM public_references WHERE active=1 ORDER BY id").all()
    .map(row => readSqlitePublicReference(db, row));
}

describe("SqliteAdapter public publisher list integration", () => {
  it.each([false, true])("preserves the real readonly enrolled caller without startup DDL (archive=%s)", async archive => {
    const f = await fixture(archive), before = readFileSync(f.file), expected = previousList(f.seed);
    const result = await f.adapter.listPublicReferences();
    expect(result).toEqual(expected);
    expect(result.map(value => [value.id, value.items.length])).toEqual([["public:alpha", 1], ["public:zeta", 10]]);
    if (archive) expect(result.map(value => value.archivedItemCount)).toEqual([1, 12]);
    else expect(result.every(value => !Object.hasOwn(value, "archivedItemCount"))).toBe(true);
    expect(Reflect.get(f.adapter, "db")).toBeUndefined();
    expect(readFileSync(f.file)).toEqual(before);
  }, 30_000);

  it("keeps native statement work constant at the actual caller as publisher count grows", async () => {
    const count = async (references: PublicReference[]) => {
      const f = await fixture(true, references);
      await f.adapter.listPublicReferences(); // Qualify lazy module setup before measuring application calls.
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
      try {
        expect(await f.adapter.listPublicReferences()).toHaveLength(references.length);
        expect(prepare.mock.calls.length).toBeGreaterThan(0);
        return prepare.mock.calls.length;
      } finally { prepare.mockRestore(); }
    };
    expect(await count(Array.from({ length: 30 }, (_, n) => publisher(`publisher-${n}`))))
      .toBe(await count([publisher("only")]));
  }, 30_000);

  it("retains actual facade refusal after archive schema drift", async () => {
    const f = await fixture(true);
    expect(await f.adapter.listPublicReferences()).toHaveLength(2);
    f.seed.exec("DROP INDEX public_reference_articles_publisher");
    await expect(Promise.resolve().then(() => f.adapter.listPublicReferences())).rejects.toThrow();
  }, 30_000);

  it("refuses malformed active snapshots through the real caller without repairing data", async () => {
    const f = await fixture(true, undefined, true);
    const before = readFileSync(f.file);
    await expect(Promise.resolve().then(() => f.adapter.listPublicReferences())).rejects.toThrow();
    expect(readFileSync(f.file)).toEqual(before);
  }, 30_000);
});
