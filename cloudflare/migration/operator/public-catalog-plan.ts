/** Generate an OFFLINE plan from a bounded public DTO stream. This never opens
 * a production datastore or accesses Cloudflare, signing keys or a network. */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../../../lib/canonical-json";
import { archiveSearchTerms } from "../../../lib/public-references/archive";
import { publicReferenceItemSchema } from "../../../lib/public-references/catalog-contract";
import { decodeReference, readArticle, digest, timestamp } from "../../../lib/db/public-reference-archive-contract";
import { catalogGuard, catalogJsonBatches, catalogJsonFields } from "../src/managed-catalog";
import { CATALOG_IDENTITY } from "../src/catalog-schema.mjs";
import profile from "../src/catalog-profile.json" with { type: "json" };
import { EMPTY_DIGEST, PUBLIC_EXPORT_LIMITS, rollDigest, sha256 } from "./public-catalog-export";
import { publicExportRecord, type ExportArticle } from "./public-catalog-wire";

type Value = string | number | null;
type Query = { sql: string; params: Value[] };
const refuse = () => new Error("Public catalog plan refused");
const key = (row: { reference_id: string; item_id: string; revision?: string; current_revision?: string }) => canonicalJson([row.reference_id, row.item_id, row.revision ?? row.current_revision]);
const objectKey = (hash: string) => "catalog/v1/sha256/" + hash;
const MAX_LINE_BYTES = 16 * 1024 * 1024;

async function* records(source: string) {
  let pending: Buffer[] = [], pendingBytes = 0, total = 0;
  const stream = createReadStream(source, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > PUBLIC_EXPORT_LIMITS.outputBytes) throw refuse();
      let start = 0;
      for (let end = 0; end < chunk.length; end++) if (chunk[end] === 10) {
        const part = chunk.subarray(start, end); pendingBytes += part.length;
        if (pendingBytes > MAX_LINE_BYTES) throw refuse();
        pending.push(part);
        const line = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(pending, pendingBytes));
        const parsed = JSON.parse(line);
        if (canonicalJson(parsed) !== line) throw refuse();
        yield { value: publicExportRecord.parse(parsed), bytes: pendingBytes + 1 };
        pending = []; pendingBytes = 0; start = end + 1;
      }
      if (start < chunk.length) { pending.push(chunk.subarray(start)); pendingBytes += chunk.length - start; }
      if (pendingBytes > MAX_LINE_BYTES) throw refuse();
    }
    if (pendingBytes) throw refuse(); // A completed export always has its final LF.
  } finally { stream.destroy(); }
}

export async function planPublicCatalog(source: string, directory: string) {
  const deadline = Date.now() + 180_000;
  const tick = () => { if (Date.now() >= deadline) throw refuse(); };
  // Exclusive new output. A partial/old plan is never adopted or overwritten.
  await mkdir(directory);
  await mkdir(join(directory, "objects")); await mkdir(join(directory, "batches"));
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE terms(term TEXT,reference_id TEXT,item_id TEXT,revision TEXT,weight INTEGER,
    PRIMARY KEY(term,reference_id,item_id));`);
  const insertTerm = db.prepare("INSERT INTO terms VALUES (?,?,?,?,?)");
  const objects = new Map<string, { key: string; sha256: string; bytes: number; file: string }>();
  const publishers: Value[][] = [], versions: Value[][] = [], indexes: Value[][] = [], articles: ExportArticle[] = [];
  const pointers = new Map<string, ExportArticle>(), seenVersions = new Set<string>(), current = new Set<string>();
  const publisherIds = new Set<string>(), articleIds = new Set<string>(), articleUrls = new Set<string>();
  const sourcePublishers: unknown[] = [], sourceVersions: unknown[] = [];
  const rowids = { publisher: new Set<string>(), article: new Set<string>(), version: new Set<string>() };
  let header: ReturnType<typeof publicExportRecord.parse> & { type: "header" } | undefined;
  let footer: ReturnType<typeof publicExportRecord.parse> & { type: "footer" } | undefined;
  let sourceDigest = EMPTY_DIGEST, recordCount = 0, sourceBytes = 0, termCount = 0, phase = 0;
  async function put(text: string) {
    tick();
    const hash = sha256(text), found = objects.get(hash);
    if (!found) {
      const file = "objects/" + hash;
      await writeFile(join(directory, file), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      objects.set(hash, { key: objectKey(hash), sha256: hash, bytes: Buffer.byteLength(text), file });
    }
    return objectKey(hash);
  }
  try {
    for await (const record of records(source)) {
      tick();
      const value = record.value;
      if (footer) throw refuse();
      if (value.type === "footer") {
        if (!header || value.records !== recordCount || value.sourceDigest !== sourceDigest || value.outputBytesBeforeFooter !== sourceBytes) throw refuse();
        if (value.completedAt < header.startedAt) throw refuse();
        footer = value; continue;
      }
      sourceDigest = rollDigest(sourceDigest, value); sourceBytes += record.bytes; recordCount++;
      if (value.type === "header") { if (header || recordCount !== 1) throw refuse(); header = value; continue; }
      if (!header || recordCount > PUBLIC_EXPORT_LIMITS.rows + 1) throw refuse();
      const nextPhase = { publisher: 1, article: 2, version: 3 }[value.type];
      if (nextPhase < phase || rowids[value.type].has(value.row.rowid)) throw refuse();
      rowids[value.type].add(value.row.rowid); phase = nextPhase;
      if (value.type === "publisher") {
        decodeReference(value.row);
        if (publisherIds.has(value.row.id)) throw refuse(); publisherIds.add(value.row.id);
        sourcePublishers.push(value.row);
        publishers.push([value.row.id, value.row.active, value.row.rss_url, await put(value.row.snapshot)]);
      } else if (value.type === "article") {
        const k = key(value.row);
        const id = canonicalJson([value.row.reference_id, value.row.item_id]), url = canonicalJson([value.row.reference_id, value.row.canonical_url]);
        if (pointers.has(k) || articleIds.has(id) || articleUrls.has(url)) throw refuse(); articleIds.add(id); articleUrls.add(url);
        if (timestamp(value.row.first_collected_at) > timestamp(value.row.last_collected_at)) throw refuse();
        pointers.set(k, value.row); articles.push(value.row);
      } else {
        const row = value.row, k = key(row);
        if (seenVersions.has(k)) throw refuse(); seenVersions.add(k);
        const { snapshot: _body, original_snapshot: _original, ...sourceHeader } = row;
        sourceVersions.push(sourceHeader);
        const item = publicReferenceItemSchema.parse(JSON.parse(row.snapshot));
        const projection = { ...row, item_snapshot: row.snapshot, current_revision: row.revision, canonical_url: item.link,
          first_collected_at: row.collected_at, last_collected_at: row.collected_at,
          published_at: item.publishedAt ? timestamp(item.publishedAt) : null,
          sort_at: item.publishedAt ? timestamp(item.publishedAt) : row.collected_at };
        readArticle(projection);
        versions.push([row.reference_id, row.item_id, row.revision, row.content_version, await put(row.snapshot), await put(row.original_snapshot), row.collection_kind, row.collected_at]);
        const pointer = pointers.get(k);
        if (pointer) {
          readArticle({ ...projection, ...pointer }); current.add(k);
          const weights = new Map<string, number>();
          for (const [text, weight] of [[item.title, 6], [item.summary, 2], [item.content, 1]] as const)
            for (const term of archiveSearchTerms(text)) weights.set(term, (weights.get(term) ?? 0) + weight);
          indexes.push([row.reference_id, row.item_id, row.revision, weights.size,
            digest([...weights].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]))))]);
          db.exec("BEGIN");
          try {
            for (const [term, weight] of weights) {
              if (++termCount > header.counts.terms || termCount > PUBLIC_EXPORT_LIMITS.rows) throw refuse();
              insertTerm.run(term, row.reference_id, row.item_id, row.revision, weight);
            }
            db.exec("COMMIT");
          } catch (error) { db.exec("ROLLBACK"); throw error; }
        }
      }
    }
    if (!header || !footer || publishers.length !== header.counts.publishers || articles.length !== header.counts.articles
      || versions.length !== header.counts.versions || termCount !== header.counts.terms || current.size !== articles.length) throw refuse();
    if (Buffer.byteLength(canonicalJson([sourcePublishers, sourceVersions, articles])) > PUBLIC_EXPORT_LIMITS.metadataBytes
      || sha256(canonicalJson({ publishers: sourcePublishers, versions: sourceVersions, articles,
        counts: header.counts, termsDigest: header.termsDigest })) !== header.metadataDigest) throw refuse();
    const termsHash = createHash("sha256");
    let boundary: string[] = [], page;
    do {
      tick();
      page = db.prepare(`SELECT term,reference_id,item_id,revision,weight FROM terms ${boundary.length ? "WHERE (term,reference_id,item_id)>(?,?,?)" : ""}
        ORDER BY term,reference_id,item_id LIMIT 2048`).all(...boundary);
      for (const row of page) termsHash.update(canonicalJson([row.term, row.reference_id, row.item_id, row.weight]) + "\n");
      const last = page.at(-1); if (last) boundary = [String(last.term), String(last.reference_id), String(last.item_id)];
    } while (page.length === 2048);
    if (termsHash.digest("hex") !== header.termsDigest) throw refuse();
    const generation = "vps-public-" + sourceDigest;
    const files: { file: string; sha256: string; statements: number }[] = [];
    async function file(queries: Query[]) {
      tick();
      const name = "batches/" + String(files.length).padStart(5, "0") + ".json", text = canonicalJson(queries);
      await writeFile(join(directory, name), text, { encoding: "utf8", flag: "wx", mode: 0o600 });
      files.push({ file: name, sha256: sha256(text), statements: queries.length });
    }
    const emptyGuard: Query = { sql: `SELECT CASE WHEN count(*)=0 THEN 1 ELSE json_extract('new catalog must be empty','$') END admitted
      FROM sqlite_schema s WHERE s.sql IS NOT NULL AND s.name NOT GLOB 'sqlite_*'
      AND NOT(s.type='table' AND s.name IN ('_cf_METADATA','_cf_KV','d1_migrations'))`, params: [] };
    const bootstrap = [emptyGuard, ...[...profile.objects].sort((a, b) => ["table", "index", "trigger"].indexOf(a[1]) - ["table", "index", "trigger"].indexOf(b[1]))
      .map(row => ({ sql: row[2], params: [] })), { sql: "INSERT INTO catalog_control(generation,identity,revision,ready) VALUES (?,?,0,0)", params: [generation, CATALOG_IDENTITY] }];
    await file(bootstrap);
    const unready: Query = { sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM catalog_control WHERE generation=? AND ready=0 AND revision=0)
      THEN 1 ELSE json_extract('catalog import is not admitted','$') END admitted`, params: [generation] };
    let pending: Query[] = [];
    const flush = async () => { if (pending.length) { await file([catalogGuard(generation, 0, false), unready, ...pending]); pending = []; } };
    const append = async (query: Query) => { pending.push(query); if (pending.length === 8) await flush(); };
    for (const rows of catalogJsonBatches(versions)) await append({ sql: `INSERT INTO public_reference_article_versions
      (generation,reference_id,item_id,revision,content_version,snapshot_key,original_key,collection_kind,collected_at)
      SELECT ?,${catalogJsonFields(8)} FROM json_each(?) WHERE 1 ON CONFLICT(generation,reference_id,item_id,revision) DO NOTHING`, params: [generation, rows] });
    for (const rows of catalogJsonBatches(indexes)) await append({ sql: `INSERT INTO catalog_index_revisions
      (generation,reference_id,item_id,revision,terms_count,terms_digest,algorithm,complete)
      SELECT ?,${catalogJsonFields(5)},'literal-weights-nfkc-v1',0 FROM json_each(?) WHERE 1
      ON CONFLICT(generation,reference_id,item_id,revision) DO NOTHING`, params: [generation, rows] });
    boundary = [];
    do {
      page = db.prepare(`SELECT term,reference_id,item_id,revision,weight FROM terms ${boundary.length ? "WHERE (term,reference_id,item_id)>(?,?,?)" : ""}
        ORDER BY term,reference_id,item_id LIMIT 2048`).all(...boundary);
      for (const rows of catalogJsonBatches(page.map(row => [row.term, row.reference_id, row.item_id, row.revision, row.weight] as Value[])))
        await append({ sql: `INSERT INTO public_reference_article_terms(generation,term,reference_id,item_id,revision,weight)
          SELECT ?,${catalogJsonFields(5)} FROM json_each(?) j WHERE EXISTS(SELECT 1 FROM catalog_index_revisions i
          WHERE i.generation=? AND i.reference_id=json_extract(j.value,'$[1]') AND i.item_id=json_extract(j.value,'$[2]') AND i.revision=json_extract(j.value,'$[3]') AND i.complete=0)
          ON CONFLICT(generation,term,reference_id,item_id,revision) DO NOTHING`, params: [generation, rows, generation] });
      const last = page.at(-1); if (last) boundary = [String(last.term), String(last.reference_id), String(last.item_id)];
    } while (page.length === 2048);
    await append({ sql: `UPDATE catalog_index_revisions SET complete=1 WHERE generation=? AND complete=0
      AND terms_count=(SELECT count(*) FROM public_reference_article_terms t WHERE t.generation=catalog_index_revisions.generation
      AND t.reference_id=catalog_index_revisions.reference_id AND t.item_id=catalog_index_revisions.item_id AND t.revision=catalog_index_revisions.revision)`, params: [generation] });
    const articleRows = articles.map(row => [row.reference_id, row.item_id, row.canonical_url, row.current_revision,
      row.first_collected_at, row.last_collected_at, row.published_at, row.sort_at]);
    for (const rows of catalogJsonBatches(articleRows)) await append({ sql: `INSERT INTO public_reference_articles
      (generation,reference_id,item_id,canonical_url,current_revision,first_collected_at,last_collected_at,published_at,sort_at)
      SELECT ?,${catalogJsonFields(8)} FROM json_each(?) WHERE 1 ON CONFLICT(generation,reference_id,item_id) DO NOTHING`, params: [generation, rows] });
    for (const rows of catalogJsonBatches(publishers)) await append({ sql: `INSERT INTO public_references(generation,id,active,rss_url,snapshot_key)
      SELECT ?,${catalogJsonFields(4)} FROM json_each(?) WHERE 1 ON CONFLICT(generation,id) DO NOTHING`, params: [generation, rows] });
    await flush();
    const manifest = { format: "keryx-public-catalog-plan-v1", authority: "public-data-only", generation, sourceDigest,
      sourceHeader: header, sourceFooter: footer, objects: [...objects.values()], files,
      objectBytes: [...objects.values()].reduce((sum, value) => sum + value.bytes, 0), ready: false,
      note: "No network or production mutation. Separate target/readback/blob verification is required before ready=1." };
    const serialized = canonicalJson(manifest);
    await writeFile(join(directory, "manifest.json"), serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { generation, sourceDigest, objects: objects.size, batches: files.length, manifestSha256: sha256(serialized), productionReady: false };
  } finally { db.close(); }
}
