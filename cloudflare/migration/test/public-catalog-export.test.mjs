import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../../lib/canonical-json.ts";
import { installPublicReferenceArchive, upsertSqlitePublicReference, archiveSqlitePublicReferenceItems } from "../../../lib/db/public-reference-archive.ts";
import { publicReferenceItemId } from "../../../lib/public-references/catalog-contract.ts";
import { exportPublicCatalog, EMPTY_DIGEST, rollDigest, PUBLIC_EXPORT_LIMITS } from "../operator/public-catalog-export.ts";

const at = "2026-10-12T00:00:00.000Z";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE public_references(id TEXT PRIMARY KEY,active INTEGER NOT NULL,rss_url TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE private_fixture(secret TEXT)");
  db.prepare("INSERT INTO private_fixture VALUES (?)").run("private-canary-must-never-be-exported");
  installPublicReferenceArchive(db);
  const id = "public:export-fixture", link = "https://fixture.invalid/public";
  const item = { id: publicReferenceItemId(id, link), link, title: "Original title", summary: "Public summary", content: "Alpha beta original evidence", deliveryKind: "excerpt" };
  const publisher = { id, name: "Public fixture", url: "https://fixture.invalid/", rssUrl: "https://fixture.invalid/feed", description: "Public metadata", tags: [], active: true, items: [item], refreshedAt: at };
  upsertSqlitePublicReference(db, publisher);
  archiveSqlitePublicReferenceItems(db, id, [{ ...item, content: "Alpha beta replacement evidence with more retained text", deliveryKind: "full_text" }], "article", at);
  return { db, publisher, item };
}
test("public export retains raw historical originals and current metadata while excluding private tables", async () => {
  const { db } = fixture(), records = [];
  try {
    const footer = await exportPublicCatalog(db, async record => { records.push(record); }, "a".repeat(64));
    assert.equal(footer.sourceChangedSinceSnapshot, false); assert.equal(db.isTransaction, false);
    assert.equal(records[0].authority, "public-data-only");
    assert.deepEqual(records[0].counts, { publishers: 1, articles: 1, versions: 2, terms: 11 });
    const versions = records.filter(record => record.type === "version"); assert.equal(versions.length, 2);
    for (const { row } of versions) {
      const original = db.prepare("SELECT CAST(rowid AS TEXT) rowid,snapshot,original_snapshot FROM public_reference_article_versions WHERE reference_id=? AND item_id=? AND revision=?").get(row.reference_id, row.item_id, row.revision);
      assert.equal(row.snapshot, original.snapshot); assert.equal(row.original_snapshot, original.original_snapshot); assert.equal(row.rowid, original.rowid);
    }
    assert.equal(footer.sourceDigest, records.slice(0, -1).reduce((prior, record) => rollDigest(prior, record), EMPTY_DIGEST));
    assert(!canonicalJson(records).includes("private-canary")); assert(!canonicalJson(records).includes("private_fixture"));
    assert.equal(records.filter(record => record.type === "article").length, 1);
  } finally { db.close(); }
});
test("publication changes after the snapshot are reported without mixing new metadata into frozen originals", async () => {
  const { db, publisher } = fixture(), records = []; let changed = false;
  try {
    const footer = await exportPublicCatalog(db, async record => {
      records.push(record);
      if (!changed) { changed = true; upsertSqlitePublicReference(db, { ...publisher, name: "Changed publisher", active: false }); }
    }, "b".repeat(64));
    assert.equal(footer.sourceChangedSinceSnapshot, true);
    assert.equal(JSON.parse(records.find(record => record.type === "publisher").row.snapshot).active, true);
    assert.equal(db.prepare("SELECT active FROM public_references").get().active, 0);
  } finally { db.close(); }
});
test("invalid retained bytes refuse without a completed receipt or leaving a read transaction", async () => {
  const { db } = fixture(), records = [];
  try {
    db.exec("DROP TRIGGER public_reference_versions_immutable"); // Explicit fixture corruption only.
    db.prepare("UPDATE public_reference_article_versions SET original_snapshot=?").run(new Uint8Array([255, 254]));
    await assert.rejects(exportPublicCatalog(db, async record => { records.push(record); }, "c".repeat(64)));
    assert(!records.some(record => record.type === "footer")); assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});
test("an oversized original refuses before returning its bytes to the export consumer", async () => {
  const { db } = fixture(), records = [];
  try {
    db.exec("DROP TRIGGER public_reference_versions_immutable");
    db.prepare("UPDATE public_reference_article_versions SET original_snapshot=?").run("x".repeat(PUBLIC_EXPORT_LIMITS.fieldBytes + 1));
    await assert.rejects(exportPublicCatalog(db, async record => { records.push(record); }, "d".repeat(64)));
    assert(!records.some(record => record.type === "version" || record.type === "footer")); assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});
