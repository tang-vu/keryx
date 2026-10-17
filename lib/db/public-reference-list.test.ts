import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicReferenceItemId, type PublicReference } from "../public-references/catalog";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { readSqlitePublicReference, upsertSqlitePublicReference } from "./public-reference-archive";
import { listSqlitePublicReferences } from "./public-reference-list";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";

const connections: DatabaseSync[] = [], directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of connections.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function database(archive = true, file = ":memory:") {
  const db = new DatabaseSync(file); connections.push(db);
  installSqliteApplicationSchema(db, { publicReferenceArchive: archive });
  return db;
}
function publisher(id: string, count = 0, active = true): PublicReference {
  const referenceId = `public:${id}`;
  return { id: referenceId, name: id, url: `https://${id}.example/`, rssUrl: `https://${id}.example/feed`,
    description: "Synthetic public reference", tags: [], active,
    items: Array.from({ length: count }, (_, n) => {
      const link = `https://${id}.example/${n}`;
      return { id: publicReferenceItemId(referenceId, link), link, title: `Article ${n}`, summary: "Retained excerpt",
        content: "Synthetic excerpt.", publishedAt: "2026-10-17T00:00:00.000Z", deliveryKind: "excerpt" as const };
    }) };
}
function insertSnapshot(db: DatabaseSync, reference: PublicReference) {
  db.prepare("INSERT INTO public_references(id,active,rss_url,snapshot) VALUES(?,?,?,?)")
    .run(reference.id, Number(reference.active), reference.rssUrl, JSON.stringify(reference));
}
function previousList(db: DatabaseSync) {
  return db.prepare("SELECT id,active,rss_url,snapshot FROM public_references WHERE active=1 ORDER BY id").all()
    .map(row => readSqlitePublicReference(db, row));
}

describe("fresh batched public reference listing", () => {
  it("preserves sorted snapshots, ten-item previews and lifetime article counts", () => {
    const db = database();
    for (const reference of [publisher("zeta", 12), publisher("alpha", 2), publisher("empty"), publisher("hidden", 4, false)])
      upsertSqlitePublicReference(db, reference);
    const result = listSqlitePublicReferences(db);
    expect(result).toEqual(previousList(db));
    expect(result.map(value => [value.id, value.items.length, value.archivedItemCount]))
      .toEqual([["public:alpha", 2, 2], ["public:empty", 0, 0], ["public:zeta", 10, 12]]);
    expect(db.isTransaction).toBe(false);
  });
  it("keeps legacy stores readable without adding archive schema or counts", () => {
    const db = database(false); insertSnapshot(db, publisher("legacy", 12));
    const schema = db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all();
    expect(listSqlitePublicReferences(db)).toEqual(previousList(db));
    expect(listSqlitePublicReferences(db)[0]).not.toHaveProperty("archivedItemCount");
    expect(listSqlitePublicReferences(db)[0].items).toHaveLength(10);
    expect(db.prepare("SELECT name,sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);
  });
  it("uses a constant number of statements as the active publisher list grows", () => {
    const db = database();
    for (let n = 0; n < 40; n++) insertSnapshot(db, publisher(`publisher-${n}`));
    const prepare = vi.spyOn(db, "prepare");
    expect(listSqlitePublicReferences(db)).toHaveLength(40);
    const many = prepare.mock.calls.length;
    expect(many).toBeLessThanOrEqual(3);
    prepare.mockClear();
    db.exec("DELETE FROM public_references");
    insertSnapshot(db, publisher("only")); prepare.mockClear();
    expect(listSqlitePublicReferences(db)).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(many);
  });
  it.each(["id", "active", "rss", "json", "shape"])("refuses a corrupt %s snapshot and ends its read transaction", field => {
    const db = database(), reference = publisher("corrupt"); insertSnapshot(db, reference);
    const value = field === "id" ? { ...reference, id: "public:different" }
      : field === "active" ? { ...reference, active: false }
      : field === "rss" ? { ...reference, rssUrl: "https://different.example/feed" }
      : field === "shape" ? { ...reference, items: "invalid" } : reference;
    db.prepare("UPDATE public_references SET snapshot=? WHERE id=?").run(field === "json" ? "{" : JSON.stringify(value), reference.id);
    expect(() => listSqlitePublicReferences(db)).toThrow();
    expect(db.isTransaction).toBe(false);
    expect(() => previousList(db)).toThrow();
  });
  it("refreshes article totals and activation on every call without exposing inactive snapshots", () => {
    const db = database(), reference = publisher("fresh", 1);
    upsertSqlitePublicReference(db, reference);
    expect(listSqlitePublicReferences(db)[0].archivedItemCount).toBe(1);
    upsertSqlitePublicReference(db, publisher("fresh", 3));
    expect(listSqlitePublicReferences(db)[0].archivedItemCount).toBe(3);
    db.prepare("UPDATE public_references SET active=0,snapshot='invalid hidden JSON' WHERE id=?").run(reference.id);
    expect(listSqlitePublicReferences(db)).toEqual([]);
  });
  it("retains native verified-connection refusal after schema drift", () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-public-list-")); directories.push(directory);
    const file = join(directory, "synthetic.sqlite"), db = database(true, file), identity = syntheticStorageIdentity("testnet-offline");
    insertSnapshot(db, publisher("verified"));
    insertStorageIdentity(db, identity); installStorageFences(db, identity);
    const verified = openVerifiedSqliteStorage(file, identity, { readOnly: true, applicationProfiles: supportedSqliteApplicationProfiles() });
    try {
      expect(listSqlitePublicReferences(verified.db)).toHaveLength(1);
      const index = db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name LIKE 'public_reference_articles_%' LIMIT 1").get();
      expect(index).toBeDefined();
      db.exec(`DROP INDEX "${String(index!.name).replaceAll('"', '""')}"`);
      expect(() => listSqlitePublicReferences(verified.db)).toThrow();
    } finally { verified.close(); }
  }, 30_000);
});
