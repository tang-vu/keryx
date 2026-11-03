import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { canonicalJson } from "../../../lib/canonical-json.ts";
import { installPublicReferenceArchive, upsertSqlitePublicReference, archiveSqlitePublicReferenceItems,
  querySqlitePublicReferenceItems } from "../../../lib/db/public-reference-archive.ts";
import { publicReferenceItemId } from "../../../lib/public-references/catalog-contract.ts";
import { exportPublicCatalog, sha256 } from "../operator/public-catalog-export.ts";
import { planPublicCatalog } from "../operator/public-catalog-plan.ts";
import { ManagedCatalog } from "../src/managed-catalog.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const temporary = resolve(common, "../.local/tmp/cloudflare-full-migration-20261103/catalog-plan-tests");
await mkdir(temporary, { recursive: true });
function fixture(count = 5, words = 0) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE public_references(id TEXT PRIMARY KEY,active INTEGER NOT NULL,rss_url TEXT NOT NULL,snapshot TEXT NOT NULL)");
  installPublicReferenceArchive(db);
  const id = "public:import-fixture", at = "2026-10-12T00:00:00.000Z";
  const items = Array.from({ length: count }, (_, n) => {
    const link = "https://fixture.invalid/article/" + n;
    return { id: publicReferenceItemId(id, link), link, title: "Literal alpha " + n, summary: "Public beta summary",
      content: "Retained evidence " + n + "\nUnicode: Tiếng Việt 𝒜 " + Array.from({ length: words }, (_, word) => "word" + word).join(" "), deliveryKind: "excerpt", ...(n % 2 ? { publishedAt: at } : {}) };
  });
  const publisher = { id, name: "Public import fixture", url: "https://fixture.invalid/", rssUrl: "https://fixture.invalid/feed",
    description: "Public metadata", tags: [], active: true, items, refreshedAt: at };
  upsertSqlitePublicReference(db, publisher);
  archiveSqlitePublicReferenceItems(db, id, [{ ...items[0], content: "Retained full replacement evidence. ".repeat(30), deliveryKind: "full_text" }], "article", at);
  return db;
}
async function exported(db, folder) {
  const records = []; await exportPublicCatalog(db, async record => { records.push(record); }, "d".repeat(64));
  const source = join(folder, "public-export.jsonl");
  await writeFile(source, records.map(canonicalJson).join("\n") + "\n", { flag: "wx" });
  return { source, records };
}
test("an offline public-data plan imports exact historical bytes into real D1/R2 without publishing early", async () => {
  const db = fixture(55, 40), folder = await mkdtemp(join(temporary, "case-")); let runtime;
  try {
    const { source } = await exported(db, folder), output = join(folder, "plan");
    const plan = await planPublicCatalog(source, output);
    assert.equal(plan.productionReady, false);
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.ready, false); assert.equal(manifest.authority, "public-data-only");
    await writeFile(join(folder, "worker.mjs"), "export default {fetch(){return new Response('Offline fixture')}}");
    runtime = new Miniflare(convertV4MiniflareOptions({ name: "offline-import-fixture", compatibilityDate: "2026-10-23",
      modules: [{ type: "ESModule", path: join(folder, "worker.mjs") }], modulesRoot: folder,
      d1Databases: { DB: "offline-import-fixture" }, r2Buckets: { BLOBS: "offline-import-blobs" },
      resourcePersistencePath: join(folder, "state"), host: "127.0.0.1", port: 0,
      outboundService: () => { throw new Error("Public import fixture attempted external network"); } }));
    const target = await runtime.getD1Database("DB"), bucket = await runtime.getR2Bucket("BLOBS");
    const apply = async file => {
      const text = await readFile(join(output, file.file), "utf8"); assert.equal(sha256(text), file.sha256);
      const batch = JSON.parse(text); await target.batch(batch.map(q => target.prepare(q.sql).bind(...q.params)));
    };
    // Bootstrap is an explicit operator operation and refuses a nonempty target.
    await target.prepare("CREATE TABLE unexpected_source(value TEXT)").run();
    await assert.rejects(apply(manifest.files[0]));
    assert.equal(await target.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='catalog_control'").first("n"), 0);
    await target.prepare("DROP TABLE unexpected_source").run(); // Explicit test-only fixture cleanup.
    await apply(manifest.files[0]);
    const catalog = new ManagedCatalog(target, bucket, plan.generation);
    await assert.rejects(catalog.queryPublicReferenceItems({}));
    for (const object of manifest.objects) {
      const body = await readFile(join(output, object.file)); assert.equal(body.length, object.bytes); assert.equal(sha256(body.toString("utf8")), object.sha256);
      await bucket.put(object.key, body);
    }
    for (const file of manifest.files.slice(1)) await apply(file);
    await assert.rejects(catalog.queryPublicReferenceItems({}), "Preparing metadata must not set ready=1");
    for (const file of manifest.files.slice(1)) await apply(file); // Exact replay, including completed indexes.
    assert.equal(await target.prepare("SELECT count(*) n FROM public_reference_article_versions").first("n"), 56);
    assert.equal(await target.prepare("SELECT count(*) n FROM catalog_index_revisions WHERE complete=1").first("n"), 55);
    for (const object of manifest.objects) assert.equal(sha256(await (await bucket.get(object.key)).text()), object.sha256);
    const inspected = new Map();
    for (const kind of ["publishers", "versions", "terms"]) {
      let after, count = 0;
      do {
        const audit = await catalog.inspectPrepared(kind, after); assert.equal(audit.revision, 0);
        count += audit.rows.length;
        assert(!JSON.stringify(audit).includes("Retained full replacement evidence"), "Inspection never returns body text");
        for (const object of audit.objects) inspected.set(object.key, object);
        if (!after && audit.nextCursor) await assert.rejects(catalog.inspectPrepared(kind === "versions" ? "terms" : "versions", audit.nextCursor));
        after = audit.nextCursor;
      } while (after);
      assert.equal(count, manifest.sourceHeader.counts[kind]);
    }
    assert.equal(inspected.size, manifest.objects.length);
    for (const expected of manifest.objects) assert.deepEqual(inspected.get(expected.key), { key: expected.key, sha256: expected.sha256, bytes: expected.bytes });
    const victim = manifest.objects.find(object => object.key.includes("/sha256/"));
    const saved = await (await bucket.get(victim.key)).text(); await bucket.put(victim.key, "corrupt");
    await assert.rejects(catalog.inspectPrepared("publishers"));
    await bucket.put(victim.key, saved); // Explicit test-only restoration; never adapter repair.
    // Explicit FIXTURE seal after all expected metadata and actual blob checks.
    await target.prepare("UPDATE catalog_control SET ready=1 WHERE generation=?").bind(plan.generation).run();
    for (const sort of ["recent", "oldest", "relevance"]) {
      const options = { query: "literal public", sort, match: "any", limit: 100 };
      assert.deepEqual((await catalog.queryPublicReferenceItems(options)).items, querySqlitePublicReferenceItems(db, options).items);
    }
    assert.equal((await catalog.queryPublicReferenceItems({})).total, 55);
    await assert.rejects(apply(manifest.files[0]), "Bootstrap never repairs an already created target");
    await assert.rejects(apply(manifest.files[1]), "An imported generation refuses further operator staging after sealing");
    assert.equal((await catalog.queryPublicReferenceItems({})).total, 55);
    await target.prepare("UPDATE catalog_control SET revision=revision+1 WHERE generation=?").bind(plan.generation).run();
    await assert.rejects(catalog.inspectPrepared("versions"), "A live publication revision has no initial-import audit authority");
  } finally { await runtime?.dispose(); db.close(); }
});
test("a semantically inconsistent source term index cannot be silently regenerated into an accepted plan", async () => {
  const db = fixture(), folder = await mkdtemp(join(temporary, "bad-index-"));
  try {
    db.prepare("UPDATE public_reference_article_terms SET weight=weight+1 WHERE term='evidence'").run();
    const { source } = await exported(db, folder), output = join(folder, "plan");
    await assert.rejects(planPublicCatalog(source, output));
    await assert.rejects(access(join(output, "manifest.json")));
  } finally { db.close(); }
});
test("changed source bytes, unknown financial fields and duplicate JSON keys never produce an accepted plan", async t => {
  for (const corruption of ["changed-body", "financial-field", "duplicate-key", "no-final-lf"]) await t.test(corruption, async () => {
    const db = fixture(), folder = await mkdtemp(join(temporary, "bad-wire-"));
    try {
      const { source, records } = await exported(db, folder), output = join(folder, "plan");
      let text;
      if (corruption === "changed-body") records.find(record => record.type === "version").row.snapshot += " ";
      if (corruption === "financial-field") records.find(record => record.type === "publisher").row.walletAddress = "0x" + "1".repeat(40);
      text = records.map(canonicalJson).join("\n") + "\n";
      if (corruption === "duplicate-key") text = text.replace('"authority":"public-data-only"', '"authority":"public-data-only","authority":"public-data-only"');
      if (corruption === "no-final-lf") text = text.slice(0, -1);
      await writeFile(source, text);
      await assert.rejects(planPublicCatalog(source, output)); await assert.rejects(access(join(output, "manifest.json")));
    } finally { db.close(); }
  });
});
