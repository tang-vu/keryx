import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "./sqlite-adapter";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { canonicalJson } from "../canonical-json";
import { inspectSqliteEnrollment, enrollSqliteStorage } from "./storage-identity-provision";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { publicReferenceItemId, type PublicReference } from "../public-references/catalog";
import type { PublicReferenceItem } from "../public-references/archive";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { archiveSqlitePublicReferenceItems, hasPublicReferenceArchive, installPublicReferenceArchive,
  querySqlitePublicReferenceItems, sqlitePublicReferenceArchiveStats, upsertSqlitePublicReference } from "./public-reference-archive";

const publisher: PublicReference = { id: "public:archive-test", name: "Archive", url: "https://archive.test/",
  rssUrl: "https://archive.test/feed", description: "Public evidence", tags: [], active: true, items: [] };
const DATE = "2026-10-12T00:00:00.000Z";
function article(n: number, overrides: Partial<PublicReferenceItem> = {}): PublicReferenceItem {
  const link = `https://archive.test/posts/${n}`;
  return { id: publicReferenceItemId(publisher.id, link), link, title: `Article ${n}`, summary: "Public archive summary",
    content: `Public historical article ${n} with evidence.`, publishedAt: DATE, deliveryKind: "excerpt", ...overrides };
}
const connections: DatabaseSync[] = [], adapters: SqliteAdapter[] = [], directories: string[] = [];
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
  for (const db of connections.splice(0)) db.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db, { publicReferenceArchive: true });
  upsertSqlitePublicReference(db, publisher);
  return db;
}
async function enrolledFixture(archive: boolean) {
  vi.resetModules();
  const directory = mkdtempSync(join(tmpdir(), "keryx-public-archive-enrolled-")); directories.push(directory);
  const file = join(directory, "store.sqlite"), manifest = join(directory, "deployment.json");
  const db = new DatabaseSync(file);
  try { db.exec("BEGIN IMMEDIATE"); installSqliteApplicationSchema(db, { publicReferenceArchive: archive }); db.exec("COMMIT"); }
  finally { db.close(); }
  const identity = syntheticStorageIdentity("testnet-offline"), inspection = await inspectSqliteEnrollment(file, identity);
  await enrollSqliteStorage(file, identity, { format: "keryx-reviewed-storage-enrollment-v1", inspection,
    provenanceDocumentDigest: identity.provenanceDigest, unknownClassAttestation: inspection.unknownClasses });
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  return { file, identity, api: await import("./enrolled-sqlite-adapter") };
}

describe("durable cumulative public archive", () => {
  it("retains more than ten articles across refresh and restart with bounded publisher previews", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-public-archive-")); directories.push(directory);
    const file = join(directory, "archive.sqlite");
    const first = new SqliteAdapter(file); await first.init();
    try {
      await first.upsertPublicReference({ ...publisher, items: Array.from({ length: 30 }, (_, n) => article(n)), refreshedAt: DATE });
      expect(await first.upsertPublicReference({ ...publisher, items: Array.from({ length: 30 }, (_, n) => article(n)), refreshedAt: DATE }))
        .toEqual({ added: 0, updated: 0 });
      await first.upsertPublicReference({ ...publisher, items: Array.from({ length: 10 }, (_, n) => article(n + 30)), refreshedAt: DATE });
      expect(await first.getPublicReference(publisher.id)).toMatchObject({ archivedItemCount: 40 });
      expect((await first.getPublicReference(publisher.id))!.items).toHaveLength(10);
      expect(await first.listSources()).toEqual([]);
      expect(await first.getSource(publisher.id)).toBeNull();
    } finally { first.close(); }
    const restarted = new SqliteAdapter(file); adapters.push(restarted); await restarted.init();
    expect((await restarted.queryPublicReferenceItems({ limit: 100 })).items).toHaveLength(40);
    expect(await restarted.publicReferenceArchiveStats()).toEqual({ articles: 40, publishers: 1,
      oldestPublishedAt: DATE, newestPublishedAt: DATE });
  });

  it("deduplicates canonical URLs, repeats idempotently and retains exact immutable revisions", () => {
    const db = database(), first = article(1);
    expect(archiveSqlitePublicReferenceItems(db, publisher.id, [first, first], "feed", DATE)).toEqual({ added: 1, updated: 0 });
    expect(archiveSqlitePublicReferenceItems(db, publisher.id, [first], "feed", DATE)).toEqual({ added: 0, updated: 0 });
    const full = { ...first, content: "Original complete body with archival detail. ".repeat(100), deliveryKind: "full_text" as const };
    expect(archiveSqlitePublicReferenceItems(db, publisher.id, [full], "article", DATE)).toEqual({ added: 0, updated: 1 });
    const abbreviated = { ...first, content: "Shorter changed feed body." };
    archiveSqlitePublicReferenceItems(db, publisher.id, [abbreviated], "feed", DATE);
    const result = querySqlitePublicReferenceItems(db, {}).items[0]!;
    expect(result.content).toBe(full.content);
    expect(result.contentVersion).toBe(sourceItemContentVersion({ ...full, sourceId: publisher.id }));
    expect(db.prepare("SELECT count(*) AS n FROM public_reference_article_versions").get()!.n).toBe(3);
    expect(() => db.exec("UPDATE public_reference_article_versions SET snapshot='{}'")).toThrow("immutable");
    expect(() => db.exec("DELETE FROM public_reference_article_versions")).toThrow("retained");
    const variantLink = first.link + "?utm_source=feed#fragment";
    const oldId = `public-item:${createHash("sha256").update(`${publisher.id}\n${variantLink}`).digest("hex")}`;
    archiveSqlitePublicReferenceItems(db, publisher.id, [{ ...first, id: oldId, link: variantLink }], "feed", DATE);
    expect(sqlitePublicReferenceArchiveStats(db).articles).toBe(1);
    expect(db.prepare("SELECT original_snapshot FROM public_reference_article_versions WHERE original_snapshot LIKE '%utm_source%'").get()).toBeDefined();
  });

  it("keeps a 42k recovered excerpt when a 1300-character feed body declares full text", () => {
    const db = database(), recovered = article(1, { deliveryKind: "excerpt", content: "r".repeat(42_000) }),
      feed = { ...recovered, deliveryKind: "full_text" as const, content: "f".repeat(1300) };
    archiveSqlitePublicReferenceItems(db, publisher.id, [recovered], "article", DATE);
    expect(archiveSqlitePublicReferenceItems(db, publisher.id, [feed], "feed", DATE)).toEqual({ added: 0, updated: 0 });
    const selected = querySqlitePublicReferenceItems(db, {}).items[0]!;
    expect(selected).toMatchObject({ content: recovered.content, deliveryKind: "excerpt", collectionKind: "article" });
    expect(selected.contentVersion).toBe(sourceItemContentVersion({ ...recovered, sourceId: publisher.id }));
    const inputs = db.prepare("SELECT original_snapshot FROM public_reference_article_versions").all()
      .map(row => JSON.parse(String(row.original_snapshot)));
    expect(inputs).toContainEqual(recovered); expect(inputs).toContainEqual(feed);
  });

  it("promotes a longer recovered excerpt over a shorter full-text-labelled feed", () => {
    const db = database(), feed = article(1, { deliveryKind: "full_text", content: "f".repeat(1300) }),
      recovered = { ...feed, deliveryKind: "excerpt" as const, content: "r".repeat(42_000) };
    archiveSqlitePublicReferenceItems(db, publisher.id, [feed], "feed", DATE);
    expect(archiveSqlitePublicReferenceItems(db, publisher.id, [recovered], "article", DATE)).toEqual({ added: 0, updated: 1 });
    const selected = querySqlitePublicReferenceItems(db, {}).items[0]!;
    expect(selected).toMatchObject({ content: recovered.content, deliveryKind: "excerpt", collectionKind: "article", publishedAt: DATE });
    expect(selected.contentVersion).toBe(sourceItemContentVersion({ ...recovered, sourceId: publisher.id }));
    upsertSqlitePublicReference(db, { ...publisher, items: [feed], refreshedAt: DATE });
    expect(querySqlitePublicReferenceItems(db, {}).items[0]!.content).toBe(recovered.content);
  });

  it("keeps original undated page inputs honest while retaining the dated feed version separately", () => {
    const db = database(), feed = article(1, { deliveryKind: "full_text", content: "f".repeat(1300) }),
      recovered = { ...feed, publishedAt: undefined, deliveryKind: "excerpt" as const, content: "r".repeat(42_000) };
    archiveSqlitePublicReferenceItems(db, publisher.id, [feed], "feed", DATE);
    archiveSqlitePublicReferenceItems(db, publisher.id, [recovered], "article", DATE);
    const selected = querySqlitePublicReferenceItems(db, {}).items[0]!;
    expect(selected.content).toBe(recovered.content); expect(selected.publishedAt).toBeUndefined();
    expect(selected.contentVersion).toBe(sourceItemContentVersion({ ...recovered, sourceId: publisher.id }));
    const versions = db.prepare("SELECT collection_kind,original_snapshot,snapshot FROM public_reference_article_versions").all();
    const original = versions.find(row => row.collection_kind === "article")!;
    expect(JSON.parse(String(original.original_snapshot))).toEqual({ ...recovered, publishedAt: undefined });
    expect(JSON.parse(String(original.snapshot)).publishedAt).toBeUndefined();
    expect(JSON.parse(String(versions.find(row => row.collection_kind === "feed")!.original_snapshot))).toEqual(feed);
  });

  it("rolls back a valid prefix when a middle item has invalid or forged public identity", () => {
    const db = database();
    expect(() => archiveSqlitePublicReferenceItems(db, publisher.id, [article(1), article(2, { id: article(3).id }), article(3)], "feed", DATE)).toThrow("identity");
    expect(sqlitePublicReferenceArchiveStats(db).articles).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM public_reference_article_versions").get()!.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM public_reference_article_terms").get()!.n).toBe(0);
    expect(() => upsertSqlitePublicReference(db, { ...publisher, items: [article(1), article(2, { id: article(3).id })] })).toThrow("identity");
    expect(JSON.parse(String(db.prepare("SELECT snapshot FROM public_references").get()!.snapshot)).items).toEqual([]);
    expect(() => archiveSqlitePublicReferenceItems(db, publisher.id, [{ ...article(1), walletAddress: "0xforged" } as PublicReferenceItem], "feed", DATE)).toThrow();
  });

  it("keeps undated originals readable when an earlier short feed observation moves first collection", () => {
    const db = database(), full = article(1, { publishedAt: undefined, deliveryKind: "full_text", content: "Retained original body ".repeat(100) });
    archiveSqlitePublicReferenceItems(db, publisher.id, [full], "article", DATE);
    upsertSqlitePublicReference(db, { ...publisher, items: [{ ...full, content: "Short feed", deliveryKind: "excerpt" }], refreshedAt: "2026-10-01T00:00:00.000Z" });
    const result = querySqlitePublicReferenceItems(db, {}).items[0]!;
    expect(result.content).toBe(full.content); expect(result.firstCollectedAt).toBe("2026-10-01T00:00:00.000Z");
    upsertSqlitePublicReference(db, { ...publisher, items: [], refreshedAt: DATE });
    expect(querySqlitePublicReferenceItems(db, {}).items[0]!.content).toBe(full.content);
  });

  it("finds historical full bodies with literal normalized terms and ranks title matches", () => {
    const db = database();
    upsertSqlitePublicReference(db, { ...publisher, items: [article(1, { content: "Historical zoology and décentralisation" }),
      article(2, { title: "Zoology", content: "This article discusses biology." })] });
    upsertSqlitePublicReference(db, { ...publisher, items: [article(3)] });
    const old = querySqlitePublicReferenceItems(db, { query: "ZOOLOGY", sort: "relevance" });
    expect(old.total).toBe(2); expect(old.items.map(value => value.id)).toEqual([article(2).id, article(1).id]);
    expect(querySqlitePublicReferenceItems(db, { query: "décentralisation" }).items[0]!.id).toBe(article(1).id);
    expect(querySqlitePublicReferenceItems(db, { query: "zoology biology", match: "all" }).total).toBe(1);
    expect(querySqlitePublicReferenceItems(db, { query: "zoology biology", match: "any" }).total).toBe(2);
    expect(querySqlitePublicReferenceItems(db, { query: "zoology OR unseen*" }).total).toBe(0);
    expect(querySqlitePublicReferenceItems(db, { query: "' UNION SELECT * FROM sources --" }).total).toBe(0);
    expect(db.prepare("EXPLAIN QUERY PLAN SELECT item_id FROM public_reference_article_terms WHERE term=?").all("zoology")
      .some(row => String(row.detail).includes("INDEX"))).toBe(true);
  });

  it("paginates tied dates/scores without duplicates and rejects cross-query cursors", () => {
    const db = database();
    upsertSqlitePublicReference(db, { ...publisher, items: Array.from({ length: 31 }, (_, n) => article(n)) });
    for (const sort of ["recent", "oldest", "relevance"] as const) {
      const ids: string[] = []; let cursor: string | undefined;
      do {
        const page = querySqlitePublicReferenceItems(db, { sort, query: "public", limit: 7, cursor });
        expect(page.total).toBe(31); ids.push(...page.items.map(value => value.id)); cursor = page.nextCursor;
      } while (cursor);
      expect(new Set(ids).size).toBe(31); expect(ids).toHaveLength(31);
    }
    const cursor = querySqlitePublicReferenceItems(db, { limit: 2 }).nextCursor!;
    expect(() => querySqlitePublicReferenceItems(db, { cursor, query: "public" })).toThrow("another query");
    expect(() => querySqlitePublicReferenceItems(db, { cursor, referenceId: publisher.id })).toThrow("another query");
    expect(() => querySqlitePublicReferenceItems(db, { cursor, sort: "oldest" })).toThrow("another query");
    expect(() => querySqlitePublicReferenceItems(db, { cursor: "invalid" })).toThrow("cursor");
  });

  it("keeps newly collected undated history after dated articles in both publication directions", () => {
    const db = database(), known2025 = article(1, { publishedAt: "2025-01-01T00:00:00.000Z" }), known2026 = article(2),
      oldUndated = article(3, { title: "Old history with unknown publication date", publishedAt: undefined });
    archiveSqlitePublicReferenceItems(db, publisher.id, [oldUndated], "article", "2026-12-31T00:00:00.000Z");
    archiveSqlitePublicReferenceItems(db, publisher.id, [known2025, known2026], "feed", DATE);
    expect(querySqlitePublicReferenceItems(db, { sort: "recent" }).items.map(value => value.id)).toEqual([known2026.id, known2025.id, oldUndated.id]);
    expect(querySqlitePublicReferenceItems(db, { sort: "oldest" }).items.map(value => value.id)).toEqual([known2025.id, known2026.id, oldUndated.id]);
    expect(querySqlitePublicReferenceItems(db, { sort: "relevance", query: "public" }).items.map(value => value.id)).toEqual([known2026.id, known2025.id, oldUndated.id]);
  });

  it("paginates mixed known-date groups, equal dates and relevance scores in their complete order", () => {
    const db = database(), collected = "2026-12-31T00:00:00.000Z";
    const inputs = Array.from({ length: 35 }, (_, n) => article(n, { publishedAt: n % 3 === 0 ? undefined : n % 3 === 1 ? DATE : "2025-01-01T00:00:00.000Z",
      title: n % 4 === 0 ? `Public high relevance ${n}` : `Article ${n}` }));
    archiveSqlitePublicReferenceItems(db, publisher.id, inputs, "feed", collected);
    for (const sort of ["recent", "oldest", "relevance"] as const) {
      const expected = [...inputs].sort((a, b) => {
        const relevance = sort === "relevance" ? Number(b.title.startsWith("Public")) - Number(a.title.startsWith("Public")) : 0;
        const publication = Number(Boolean(b.publishedAt)) - Number(Boolean(a.publishedAt));
        const date = (a.publishedAt ?? collected).localeCompare(b.publishedAt ?? collected) * (sort === "oldest" ? 1 : -1);
        return relevance || publication || date || a.id.localeCompare(b.id);
      }).map(value => value.id);
      const actual: string[] = []; let cursor: string | undefined;
      do {
        const page = querySqlitePublicReferenceItems(db, { sort, query: "public", limit: 3, cursor });
        expect(page.total).toBe(inputs.length); actual.push(...page.items.map(value => value.id)); cursor = page.nextCursor;
        if (cursor) expect(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).toMatchObject({ hasPublished: Boolean(page.items.at(-1)!.publishedAt) });
      } while (cursor);
      expect(actual).toEqual(expected); expect(new Set(actual).size).toBe(inputs.length);
    }
  });

  it("binds count and page to the same snapshot while a second WAL writer adds an article", () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-public-archive-page-")); directories.push(directory);
    const file = join(directory, "store.sqlite"), reader = new DatabaseSync(file), writer = new DatabaseSync(file);
    connections.push(reader, writer); reader.exec("PRAGMA journal_mode=WAL");
    installSqliteApplicationSchema(reader, { publicReferenceArchive: true });
    upsertSqlitePublicReference(reader, { ...publisher, items: [article(1), article(2)] });
    const prepare = reader.prepare.bind(reader); let concurrentWrite = false;
    const intercepted = vi.spyOn(reader, "prepare").mockImplementation(sql => {
      const statement = prepare(sql);
      if (!sql.startsWith("SELECT count(*) AS n FROM (SELECT a.")) return statement;
      return new Proxy(statement, { get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === "get") return (...args: unknown[]) => {
          const result = Reflect.apply(target.get, target, args);
          if (!concurrentWrite) { concurrentWrite = true; archiveSqlitePublicReferenceItems(writer, publisher.id, [article(3)], "article", DATE); }
          return result;
        };
        return typeof value === "function" ? value.bind(target) : value;
      } });
    });
    try {
      const page = querySqlitePublicReferenceItems(reader, { limit: 100 });
      expect(concurrentWrite).toBe(true); expect(page.total).toBe(2); expect(page.items).toHaveLength(2);
    } finally { intercepted.mockRestore(); }
    expect(querySqlitePublicReferenceItems(reader, { limit: 100 }).total).toBe(3);
  });

  it("hides inactive publishers without erasing their retained articles", () => {
    const db = database();
    upsertSqlitePublicReference(db, { ...publisher, items: [article(1)] });
    upsertSqlitePublicReference(db, { ...publisher, active: false, items: [] });
    expect(querySqlitePublicReferenceItems(db, { referenceId: publisher.id }).total).toBe(0);
    expect(sqlitePublicReferenceArchiveStats(db)).toEqual({ articles: 0, publishers: 0 });
    expect(() => archiveSqlitePublicReferenceItems(db, publisher.id, [article(2)], "article")).toThrow("Active");
    expect(db.prepare("SELECT count(*) AS n FROM public_reference_articles").get()!.n).toBe(1);
    upsertSqlitePublicReference(db, { ...publisher, items: [] });
    expect(querySqlitePublicReferenceItems(db, {}).total).toBe(1);
  });

  it("seeds legacy snapshots once and refuses to repair a modified archive schema", () => {
    const db = new DatabaseSync(":memory:"); connections.push(db);
    installSqliteApplicationSchema(db, { publicReferenceArchive: false });
    const legacy = { ...publisher, items: [article(1)], refreshedAt: DATE };
    db.prepare("INSERT INTO public_references(id,active,rss_url,snapshot) VALUES (?,?,?,?)").run(publisher.id, 1, publisher.rssUrl, JSON.stringify(legacy));
    expect(hasPublicReferenceArchive(db)).toBe(false);
    installPublicReferenceArchive(db); installPublicReferenceArchive(db);
    expect(querySqlitePublicReferenceItems(db, {}).total).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM public_reference_article_versions").get()!.n).toBe(1);
    db.exec("DROP INDEX public_reference_articles_publisher");
    expect(() => querySqlitePublicReferenceItems(db, {})).toThrow("unavailable");
    expect(() => installPublicReferenceArchive(db)).toThrow("refusing repair");
  });

  it("supports exact predecessor enrollment without implicitly installing or migrating", async () => {
    const db = new DatabaseSync(":memory:"); connections.push(db);
    installSqliteApplicationSchema(db, { publicReferenceArchive: false });
    const before = sqliteApplicationSchemaProfile(db, new Set());
    expect(supportedSqliteApplicationProfiles()).toContain(before);
    const identity: StorageIdentity = { format: "keryx-storage-identity-v1", authorityMode: "testnet-offline", network: "eip155:5042002",
      deploymentId: "00000000-0000-4000-8000-000000000001", storageId: "00000000-0000-4000-8000-000000000002",
      enrollmentId: "00000000-0000-4000-8000-000000000003", enrolledAt: DATE,
      profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, provenanceDigest: "a".repeat(64) };
    const core = SqliteAdapter.assembleConnectionCore(db, identity, () => {});
    await core.init();
    expect(sqliteApplicationSchemaProfile(db, new Set())).toBe(before);
    expect(await core.listPublicReferences()).toEqual([]);
    await expect(core.queryPublicReferenceItems({})).rejects.toThrow("explicit schema migration");
    await expect(core.upsertPublicReference(publisher)).rejects.toThrow("explicit schema migration");
    expect(sqliteApplicationSchemaProfile(db, new Set())).toBe(before);
    for (const publicReferenceArchive of [false, true]) {
      const mainnet = new DatabaseSync(":memory:"); connections.push(mainnet);
      installMainnetApplicationSchema(mainnet, { publicReferenceArchive });
      expect(supportedSqliteApplicationProfiles(true)).toContain(sqliteApplicationSchemaProfile(mainnet, new Set()));
    }
  });

  it("verifies retained exact public item/version provenance before returning a read", () => {
    const db = database();
    upsertSqlitePublicReference(db, { ...publisher, items: [article(1)] });
    const trigger = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='public_reference_versions_immutable'").get()!.sql);
    db.exec("DROP TRIGGER public_reference_versions_immutable");
    // Schema validation catches a removed original protection before reading content.
    expect(() => querySqlitePublicReferenceItems(db, {})).toThrow("unavailable");
    db.exec("UPDATE public_reference_article_versions SET content_version='sha256:forged'");
    db.exec(trigger);
    expect(() => querySqlitePublicReferenceItems(db, {})).toThrow("provenance differs");
  });

  it("admits the actual fenced archive facade and rejects readonly writes or missing fences", async () => {
    const fixture = await enrolledFixture(true), writer = await fixture.api.createEnrolledSqliteAdapter(); adapters.push(writer);
    await writer.upsertPublicReference({ ...publisher, items: [article(1)] });
    await writer.archivePublicReferenceItems(publisher.id, [article(2)], "article", DATE);
    expect((await writer.queryPublicReferenceItems({})).total).toBe(2);
    expect(await writer.listSources()).toEqual([]);
    const reader = await fixture.api.createReadonlyEnrolledSqliteAdapter(); adapters.push(reader);
    expect((await reader.queryPublicReferenceItems({})).total).toBe(2);
    expect(() => reader.archivePublicReferenceItems(publisher.id, [article(3)], "article")).toThrow("Readonly");
    expect(() => reader.upsertPublicReference(publisher)).toThrow("Readonly");
    const native = new DatabaseSync(fixture.file);
    try {
      const fence = `storage_fence_${createHash("sha256").update("public_reference_articles").digest("hex").slice(0, 16)}_insert`;
      native.exec(`DROP TRIGGER ${fence}`);
    } finally { native.close(); }
    expect(() => writer.queryPublicReferenceItems({})).toThrow("fence_missing_or_changed");
    await expect(fixture.api.createEnrolledSqliteAdapter()).rejects.toThrow("fence_missing_or_changed");
  }, 30_000);

  it("keeps actual predecessor facade readable and refuses archive mutation without DDL", async () => {
    const fixture = await enrolledFixture(false), writer = await fixture.api.createEnrolledSqliteAdapter(); adapters.push(writer);
    const native = new DatabaseSync(fixture.file, { readOnly: true });
    let before: string;
    try { before = sqliteApplicationSchemaProfile(native, new Set()); } finally { native.close(); }
    expect(await writer.listPublicReferences()).toEqual([]);
    await expect(writer.queryPublicReferenceItems({})).rejects.toThrow("explicit schema migration");
    await expect(writer.upsertPublicReference(publisher)).rejects.toThrow("explicit schema migration");
    const after = new DatabaseSync(fixture.file, { readOnly: true });
    try { expect(sqliteApplicationSchemaProfile(after, new Set())).toBe(before); }
    finally { after.close(); }
  }, 30_000);
});
