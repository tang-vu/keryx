import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { CATALOG_SQL, CATALOG_IDENTITY } from "../src/catalog-schema.mjs";
import { installPublicReferenceArchive, upsertSqlitePublicReference, archiveSqlitePublicReferenceItems,
  querySqlitePublicReferenceItems, sqlitePublicReferenceArchiveStats } from "../../../lib/db/public-reference-archive.ts";
import { publicReferenceItemId } from "../../../lib/public-references/catalog-contract.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(root + "package.json");
const { build } = require("esbuild");
const profile = JSON.parse(await readFile(new URL("../src/catalog-profile.json", import.meta.url), "utf8"));
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const base = resolve(common, "../.local/tmp/cloudflare-full-migration-20261103/catalog-tests");
await mkdir(base, { recursive: true });
const folder = await mkdtemp(resolve(base, "case-"));
const compiled = await build({ entryPoints: [fileURLToPath(new URL("./fixtures/catalog-worker.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", target: "esnext", external: ["node:*"], logLevel: "silent" });
await writeFile(resolve(folder, "worker.mjs"), compiled.outputFiles[0].text);
const runtime = new Miniflare(convertV4MiniflareOptions({
  name: "catalog-contract-fixture", compatibilityDate: "2026-10-23", compatibilityFlags: ["nodejs_compat"],
  modules: [{ type: "ESModule", path: resolve(folder, "worker.mjs") }], modulesRoot: folder,
  d1Databases: { DB: "catalog-contract-fixture" }, r2Buckets: { BLOBS: "catalog-contract-blobs" },
  resourcePersistencePath: folder, host: "127.0.0.1", port: 0,
  outboundService: () => { throw new Error("Catalog contract test attempted an external request"); },
}));
let database, bucket;
// Explicit SOURCE-only fixture installation; the adapter never creates/repairs DDL.
const objects = [...profile.objects].sort((a, b) => ["table", "index", "trigger"].indexOf(a[1]) - ["table", "index", "trigger"].indexOf(b[1]));
try {
  database = await runtime.getD1Database("DB"); bucket = await runtime.getR2Bucket("BLOBS");
  await database.batch(objects.map(row => database.prepare(row[2])));
} catch (error) { await runtime.dispose(); throw error; }

let counter = 0;
const at = "2026-10-12T00:00:00.000Z";
function publisher(id = "public:fixture") { return { id, name: "Public fixture", url: "https://fixture.invalid/", rssUrl: "https://fixture.invalid/feed", description: "Synthetic public metadata", tags: [], active: true, items: [], refreshedAt: at }; }
function item(n, overrides = {}) {
  const link = "https://fixture.invalid/article/" + n;
  return { id: publicReferenceItemId("public:fixture", link), title: "Public article " + n, link,
    summary: "Alpha beta public material", content: "Public fixture evidence " + n, deliveryKind: "excerpt", publishedAt: at, ...overrides };
}
async function fixture(ready = 1) {
  const generation = "fixture-" + (++counter);
  await database.prepare("INSERT INTO catalog_control(generation,identity,revision,ready) VALUES (?,?,0,?)").bind(generation, CATALOG_IDENTITY, ready).run();
  return { generation,
    async request(path, body) {
      const response = await runtime.dispatchFetch("http://fixture.invalid" + path + "?generation=" + generation,
        body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, value: await response.json() };
    },
    async call(path, body) { const result = await this.request(path, body); assert.equal(result.status, 200, JSON.stringify(result.value)); return result.value; },
  };
}
function native() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE public_references(id TEXT PRIMARY KEY,active INTEGER NOT NULL,rss_url TEXT NOT NULL,snapshot TEXT NOT NULL)");
  installPublicReferenceArchive(db); return db;
}

test("managed public catalog uses real workerd D1/R2 bindings and preserves the native contract", async t => {
  try {
    await t.test("publication, all sort/match orders, keyset pagination and statistics match SQLite", async () => {
      const f = await fixture(), db = native();
      try {
        const input = { ...publisher(), items: Array.from({ length: 23 }, (_, n) => item(n, {
          title: n % 3 ? "Public article " + n : "Alpha relevance " + n,
          ...(n % 4 === 0 ? { publishedAt: undefined } : { publishedAt: "2026-10-" + String(10 + n % 3).padStart(2, "0") + "T00:00:00.000Z" }),
        })) };
        assert.deepEqual(await f.call("/upsert", input), upsertSqlitePublicReference(db, input));
        for (const sort of ["recent", "oldest", "relevance"]) for (const match of ["all", "any"]) {
          let cursor, expectedCursor, read = 0;
          do {
            const actual = await f.call("/query", { sort, match, query: "alpha public", limit: 3, cursor });
            const expected = querySqlitePublicReferenceItems(db, { sort, match, query: "alpha public", limit: 3, cursor: expectedCursor });
            assert.deepEqual(actual.items, expected.items); assert.equal(actual.total, expected.total);
            assert.equal(Boolean(actual.nextCursor), Boolean(expected.nextCursor));
            cursor = actual.nextCursor; expectedCursor = expected.nextCursor; read += actual.items.length;
          } while (cursor);
          assert.ok(read > 0);
        }
        assert.deepEqual(await f.call("/stats"), sqlitePublicReferenceArchiveStats(db));
        const list = await f.call("/list"); assert.equal(list[0].archivedItemCount, 23); assert.equal(list[0].items.length, 10);
        assert.equal((await f.request("/query", { query: "public", cursor: (await f.call("/query", { limit: 1 })).nextCursor })).status, 503);
        assert.equal((await f.request("/query", { query: "OR *", extraAuthority: true })).status, 503);
      } finally { db.close(); }
    });
    await t.test("recovery retains full article text, exact versions, earlier observations and replay counts", async () => {
      const f = await fixture(), db = native(), p = publisher();
      try {
        await f.call("/upsert", p); upsertSqlitePublicReference(db, p);
        const a = item(50, { content: "Original full article evidence. ".repeat(100), deliveryKind: "full_text" });
        const b = { ...a, content: "Replacement full article evidence. ".repeat(110) };
        for (const [items, kind, observedAt] of [[[a, b, a], "article", at], [[{ ...a, content: "short feed", deliveryKind: "full_text" }], "feed", "2026-09-01T00:00:00.000Z"], [[a], "article", at]]) {
          const expected = archiveSqlitePublicReferenceItems(db, p.id, items, kind, observedAt);
          assert.deepEqual(await f.call("/archive", { id: p.id, items, kind, observedAt }), expected);
          assert.deepEqual((await f.call("/query", {})).items, querySqlitePublicReferenceItems(db, {}).items);
        }
        assert.equal((await database.prepare("SELECT count(*) n FROM public_reference_article_versions WHERE generation=?").bind(f.generation).first()).n, 3);
      } finally { db.close(); }
    });
    await t.test("large immutable bodies exceed D1's row limit without clipping or reconstructing originals", async () => {
      const f = await fixture(), large = item(80, { content: "\u0001".repeat(340_000), deliveryKind: "full_text" });
      await f.call("/upsert", { ...publisher(), items: [large] });
      const found = (await f.call("/query", {})).items[0]; assert.equal(found.content, large.content);
      const row = await database.prepare("SELECT snapshot_key,original_key FROM public_reference_article_versions WHERE generation=?").bind(f.generation).first();
      assert.equal(row.snapshot_key, row.original_key, "Equal normalized/original bytes share one immutable object");
      assert.ok((await bucket.get(row.original_key)).size > 2_000_000);
      assert.equal((await database.prepare("SELECT length(snapshot_key) n FROM public_reference_article_versions WHERE generation=?").bind(f.generation).first()).n, 82);
    });
    await t.test("generation-scoped search and cursors cannot read another catalog", async () => {
      const a = await fixture(), b = await fixture();
      await a.call("/upsert", { ...publisher(), items: [item(1), item(2)] });
      await b.call("/upsert", { ...publisher(), items: [item(1, { content: "foreigncatalogword" }), item(2)] });
      assert.equal((await a.call("/query", { query: "foreigncatalogword" })).total, 0);
      const cursor = (await a.call("/query", { limit: 1 })).nextCursor;
      assert.equal((await b.request("/query", { limit: 1, cursor })).status, 503);
    });
    await t.test("a publisher deactivated during blob loading is caught by the final primary revision fence", async () => {
      const f = await fixture(); await f.call("/upsert", { ...publisher(), items: [item(90)] });
      const response = await f.request("/race-read", {});
      assert.equal(response.status, 503); assert.equal(response.value.code, "archive-unavailable");
    });
    await t.test("a concurrent write aborts the entire publication batch and preserves existing metadata", async () => {
      const f = await fixture(); await f.call("/upsert", publisher());
      const response = await f.request("/race-write", { ...publisher(), items: [item(91)] });
      assert.equal(response.status, 503);
      assert.equal((await f.call("/query", {})).total, 0);
      const counts = await database.prepare("SELECT count(*) n FROM public_reference_article_versions WHERE generation=?").bind(f.generation).first();
      assert.equal(counts.n, 0, "A refused batch cannot leave a version or partial article index");
    });
    await t.test("a schema change during R2 staging is refused inside the publication transaction", async () => {
      const f = await fixture();
      try {
        assert.equal((await f.request("/race-schema", { ...publisher(), items: [item(97)] })).status, 503);
      } finally {
        const source = profile.objects.find(row => row[0] === "public_reference_versions_immutable");
        await database.prepare(source[2]).run(); // Explicit fixture restoration, never adapter repair.
      }
      assert.equal((await f.call("/query", {})).total, 0);
    });
    await t.test("R2 failure cannot publish a partially uploaded feed", async () => {
      const f = await fixture();
      assert.equal((await f.request("/fail-blobs", { ...publisher(), items: [item(98), item(99)] })).status, 503);
      assert.deepEqual(await f.call("/list"), []);
      assert.equal((await f.call("/query", {})).total, 0);
    });
    await t.test("retained-version provenance is checked against actual body bytes", async () => {
      const f = await fixture(); await f.call("/upsert", { ...publisher(), items: [item(100)] });
      await database.prepare(`INSERT INTO public_reference_article_versions
        SELECT generation,reference_id,item_id,?,content_version,snapshot_key,original_key,collection_kind,collected_at
        FROM public_reference_article_versions WHERE generation=?`).bind("b".repeat(64), f.generation).run();
      await database.prepare(`INSERT INTO catalog_index_revisions
        SELECT generation,reference_id,item_id,?,algorithm,0,terms_digest,1
        FROM catalog_index_revisions WHERE generation=?`).bind("b".repeat(64), f.generation).run();
      await database.prepare("UPDATE public_reference_articles SET current_revision=? WHERE generation=?").bind("b".repeat(64), f.generation).run();
      assert.equal((await f.request("/query", {})).status, 503);
      assert.equal((await f.request("/upsert", { ...publisher(), items: [item(100)] })).status, 503);
    });
    await t.test("bounded metadata/term batches retain a large feed and a full 32-term search", async () => {
      const f = await fixture(), db = native();
      try {
        const p = { ...publisher(), items: Array.from({ length: 180 }, (_, n) => item(200 + n, {
          content: Array.from({ length: 80 }, (_, word) => "term" + word).join(" "),
        })) };
        assert.deepEqual(await f.call("/upsert", p), upsertSqlitePublicReference(db, p));
        const options = { query: Array.from({ length: 32 }, (_, word) => "term" + word).join(" "), limit: 100, sort: "relevance" };
        assert.deepEqual((await f.call("/query", options)).items, querySqlitePublicReferenceItems(db, options).items);
        assert.equal((await f.request("/query", { query: options.query + " extraTerm" })).status, 503);
        assert.equal((await f.call("/query", { query: "the and" })).total, 0);
      } finally { db.close(); }
    });
    await t.test("corrupted R2 bytes refuse reads and are never overwritten as a repair", async () => {
      const f = await fixture(), p = { ...publisher(), items: [item(92)] }; await f.call("/upsert", p);
      const row = await database.prepare("SELECT snapshot_key FROM public_references WHERE generation=?").bind(f.generation).first();
      await bucket.put(row.snapshot_key, "corrupted");
      assert.equal((await f.request("/list")).status, 503);
      assert.equal((await f.request("/upsert", p)).status, 503);
      assert.equal(await (await bucket.get(row.snapshot_key)).text(), "corrupted");
    });
    await t.test("an interrupted large index remains unpublished and resumes without replacing retained terms", async () => {
      const f = await fixture();
      const p = { ...publisher(), items: [item(500, { content: Array.from({ length: 36_000 }, (_, n) => "ut" + n).join(" ") })] };
      assert.equal((await f.request("/fail-index", p)).status, 503);
      assert.equal((await f.call("/query", {})).total, 0);
      const staged = await database.prepare("SELECT complete FROM catalog_index_revisions WHERE generation=?").bind(f.generation).first();
      assert.equal(staged.complete, 0);
      const terms = await database.prepare("SELECT count(*) n FROM public_reference_article_terms WHERE generation=?").bind(f.generation).first();
      assert.ok(terms.n > 0 && terms.n < 36_003);
      assert.equal((await database.prepare("SELECT count(*) n FROM public_reference_article_versions WHERE generation=?").bind(f.generation).first()).n, 0);
      assert.deepEqual(await f.call("/upsert", p), { added: 1, updated: 0 });
      assert.equal((await f.call("/query", { query: "ut35999" })).total, 1);
      assert.deepEqual(await f.call("/upsert", p), { added: 0, updated: 0 });
      await assert.rejects(database.prepare("UPDATE public_reference_article_terms SET weight=9 WHERE generation=?").bind(f.generation).run());
      await assert.rejects(database.prepare("DELETE FROM public_reference_article_terms WHERE generation=?").bind(f.generation).run());
    });
    await t.test("unknown schema including misleading sqlite-like trigger names refuses before mutation", async () => {
      const f = await fixture();
      await database.prepare("CREATE TRIGGER sqliteXunknown AFTER INSERT ON public_references BEGIN SELECT 1; END").run();
      try { assert.equal((await f.request("/upsert", publisher())).status, 503); }
      finally { await database.prepare("DROP TRIGGER sqliteXunknown").run(); }
      assert.equal((await f.call("/list")).length, 0);
    });
    await t.test("unready generations accept preparation without being exposed by reads", async () => {
      const f = await fixture(0); await f.call("/upsert", { ...publisher(), items: [item(93)] });
      assert.equal((await f.request("/query", {})).status, 503);
      await database.prepare("UPDATE catalog_control SET ready=1 WHERE generation=?").bind(f.generation).run();
      assert.equal((await f.call("/query", {})).total, 1);
    });
    await t.test("inactive publisher snapshots hide articles and cannot gain payout authority", async () => {
      const f = await fixture(), p = { ...publisher(), items: [item(94)] }; await f.call("/upsert", p);
      await f.call("/upsert", { ...p, active: false });
      assert.equal((await f.call("/query", {})).total, 0);
      assert.deepEqual(await f.call("/list"), []);
      assert.equal((await f.request("/archive", { id: p.id, items: [item(95)], kind: "feed", observedAt: at })).status, 503);
      assert.equal((await f.request("/upsert", { ...p, walletAddress: "0x" + "1".repeat(40), priceUsdc: 1 })).status, 503);
    });
    await t.test("immutable history cannot be updated or deleted through raw D1 either", async () => {
      const f = await fixture(); await f.call("/upsert", { ...publisher(), items: [item(96)] });
      await assert.rejects(database.prepare("UPDATE public_reference_article_versions SET content_version='forged' WHERE generation=?").bind(f.generation).run());
      await assert.rejects(database.prepare("DELETE FROM public_reference_article_versions WHERE generation=?").bind(f.generation).run());
      assert.equal((await f.call("/query", {})).total, 1);
    });
  } finally { await runtime.dispose(); }
});
