/** Public-only, read-only export. The operator entry point supplies the sealed
 * selected connection; these bytes carry no storage, signing or payout authority. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../../lib/canonical-json";
import { decodeReference, readArticle, timestamp } from "../../../lib/db/public-reference-archive-contract";
import { publicReferenceItemSchema, publicReferenceSchema } from "../../../lib/public-references/catalog-contract";

export const PUBLIC_EXPORT_LIMITS = Object.freeze({ rows: 500_000, metadataBytes: 32 * 1024 * 1024,
  fieldBytes: 2 * 1024 * 1024, outputBytes: 192 * 1024 * 1024, deadlineMs: 120_000 });
export const EMPTY_DIGEST = "0".repeat(64);
export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const rollDigest = (prior: string, value: unknown) => sha256(prior + "\n" + canonicalJson(value));
type Row = Record<string, unknown>;
export class PublicCatalogExportError extends Error {
  constructor(readonly code: "public_export_snapshot_deadline" | "public_export_processing_deadline") { super("Public catalog export refused"); }
}
const refused = () => new Error("Public catalog export refused");
const versionKey = (row: Row) => canonicalJson([row.reference_id, row.item_id, row.revision ?? row.current_revision]);
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value));
function text(value: unknown): string {
  if (!(value instanceof Uint8Array) || value.byteLength > PUBLIC_EXPORT_LIMITS.fieldBytes) throw refused();
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
}
function safeCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > PUBLIC_EXPORT_LIMITS.rows) throw refused();
  return Number(value);
}
function identity(row: Row) {
  publicReferenceSchema.shape.id.parse(row.reference_id);
  publicReferenceItemSchema.shape.id.parse(row.item_id);
  if (typeof row.rowid !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(row.rowid)) throw refused();
}

/** Mutable headers and regenerable-index digest share ONE short read snapshot.
 * Body reads happen later: source-known immutable version triggers retain those
 * exact rows while the predecessor continues serving and accepting new work. */
function snapshot(db: DatabaseSync, tick: () => void) {
  if (db.isTransaction) throw refused();
  const snapshotDeadline = Date.now() + 15_000;
  const check = () => { tick(); if (Date.now() >= snapshotDeadline) throw new PublicCatalogExportError("public_export_snapshot_deadline"); };
  db.exec("BEGIN");
  try {
    check();
    const quantity = db.prepare(`SELECT
      (SELECT count(*) FROM public_references) publishers,
      (SELECT count(*) FROM public_reference_articles) articles,
      (SELECT count(*) FROM public_reference_article_versions) versions,
      (SELECT count(*) FROM public_reference_article_terms) terms`).get()!;
    const counts = Object.fromEntries(Object.entries(quantity).map(([key, value]) => [key, safeCount(value)]));
    if (Object.values(counts).reduce((sum, value) => sum + value, 0) > PUBLIC_EXPORT_LIMITS.rows) throw refused();
    const size = db.prepare(`SELECT sum(length(CAST(snapshot AS BLOB))) n,max(length(CAST(snapshot AS BLOB))) largest,
      sum(typeof(snapshot)!='text') invalid FROM public_references`).get()!;
    if (Number(size.n ?? 0) > PUBLIC_EXPORT_LIMITS.metadataBytes || Number(size.largest ?? 0) > PUBLIC_EXPORT_LIMITS.fieldBytes || Number(size.invalid ?? 0)) throw refused();
    const aggregates: [string, string[]][] = [
      ["public_reference_article_versions", ["reference_id", "item_id", "revision", "content_version", "collection_kind", "collected_at"]],
      ["public_reference_articles", ["reference_id", "item_id", "canonical_url", "current_revision", "first_collected_at", "last_collected_at", "published_at", "sort_at"]],
    ];
    for (const [table, columns] of aggregates) {
      check();
      // Identifiers are compiled literals, never selected from source data.
      const terms = columns.map(column => `coalesce(length(CAST(${column} AS BLOB)),0)`);
      const limits = db.prepare(`SELECT sum(${terms.join("+")}) n,max(max(${terms.join(",")})) largest FROM ${table}`).get()!;
      if (Number(limits.n ?? 0) > PUBLIC_EXPORT_LIMITS.metadataBytes || Number(limits.largest ?? 0) > 4096) throw refused();
    }
    const indexLimits = db.prepare(`SELECT max(length(CAST(term AS BLOB))) largest,
      sum(typeof(term)!='text' OR typeof(weight)!='integer' OR weight NOT BETWEEN 1 AND 9) invalid
      FROM public_reference_article_terms`).get()!;
    if (Number(indexLimits.largest ?? 0) > 400 || Number(indexLimits.invalid ?? 0)) throw refused();
    const publishers = db.prepare(`SELECT CAST(rowid AS TEXT) rowid,id,active,rss_url,CAST(snapshot AS BLOB) snapshot
      FROM public_references ORDER BY id`).all().map(row => ({ ...row, snapshot: text(row.snapshot) }));
    const versions = db.prepare(`SELECT CAST(rowid AS TEXT) rowid,reference_id,item_id,revision,content_version,collection_kind,collected_at
      FROM public_reference_article_versions ORDER BY reference_id,item_id,revision`).all();
    const articles = db.prepare(`SELECT CAST(rowid AS TEXT) rowid,reference_id,item_id,canonical_url,current_revision,
      first_collected_at,last_collected_at,published_at,sort_at FROM public_reference_articles ORDER BY reference_id,item_id`).all();
    if (bytes([publishers, versions, articles]) > PUBLIC_EXPORT_LIMITS.metadataBytes) throw refused();
    const termsHash = createHash("sha256");
    let termsCount = 0, boundary: unknown[] = [], page: Row[];
    do {
      check();
      page = db.prepare(`SELECT term,reference_id,item_id,weight FROM public_reference_article_terms
        ${boundary.length ? "WHERE (term,reference_id,item_id)>(?,?,?)" : ""}
        ORDER BY term,reference_id,item_id LIMIT 8192`).all(...boundary as string[]);
      for (const row of page) {
        if (typeof row.term !== "string" || row.term.length > 100 || !Number.isSafeInteger(row.weight) || Number(row.weight) < 1 || Number(row.weight) > 9) throw refused();
        publicReferenceSchema.shape.id.parse(row.reference_id); publicReferenceItemSchema.shape.id.parse(row.item_id);
        termsHash.update(canonicalJson([row.term, row.reference_id, row.item_id, row.weight]) + "\n");
        if (++termsCount > counts.terms) throw refused();
      }
      const last = page.at(-1); if (last) boundary = [last.term, last.reference_id, last.item_id];
    } while (page.length === 8192);
    if (termsCount !== counts.terms) throw refused();
    check(); db.exec("COMMIT");
    return { publishers, versions, articles, counts, termsDigest: termsHash.digest("hex") };
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
}

export async function exportPublicCatalog(db: DatabaseSync, emit: (record: unknown) => Promise<void>, selectedIdentityDigest: string) {
  if (!/^[a-f0-9]{64}$/.test(selectedIdentityDigest)) throw refused();
  const startedAt = new Date().toISOString(), deadline = Date.now() + PUBLIC_EXPORT_LIMITS.deadlineMs;
  const tick = () => { if (Date.now() >= deadline) throw new PublicCatalogExportError("public_export_processing_deadline"); };
  const frozen = snapshot(db, tick), metadataDigest = sha256(canonicalJson(frozen));
  let outputBytes = 0, records = 0, sourceDigest = EMPTY_DIGEST;
  async function write(record: unknown, footer = false) {
    tick(); outputBytes += bytes(record) + 1;
    if (outputBytes > PUBLIC_EXPORT_LIMITS.outputBytes) throw refused();
    if (!footer) { sourceDigest = rollDigest(sourceDigest, record); records++; }
    await emit(record); tick();
  }
  await write({ type: "header", format: "keryx-public-catalog-export-v1", startedAt, selectedIdentityDigest,
    counts: frozen.counts, termsDigest: frozen.termsDigest, metadataDigest, authority: "public-data-only" });
  for (const row of frozen.publishers) { decodeReference(row); await write({ type: "publisher", row }); }
  for (const row of frozen.articles) {
    identity(row);
    if (timestamp(String(row.first_collected_at)) > timestamp(String(row.last_collected_at))) throw refused();
    await write({ type: "article", row });
  }
  const pointers = new Map(frozen.articles.map(row => [versionKey(row), row]));
  const retained = new Set<string>();
  for (let offset = 0; offset < frozen.versions.length; offset += 4) {
    tick();
    const headers = frozen.versions.slice(offset, offset + 4);
    const rows = db.prepare(`SELECT CAST(rowid AS TEXT) rowid,reference_id,item_id,revision,content_version,collection_kind,collected_at,
      CASE WHEN typeof(snapshot)='text' AND length(CAST(snapshot AS BLOB))<=2097152 THEN CAST(snapshot AS BLOB) ELSE NULL END snapshot,
      CASE WHEN typeof(original_snapshot)='text' AND length(CAST(original_snapshot AS BLOB))<=2097152 THEN CAST(original_snapshot AS BLOB) ELSE NULL END original_snapshot
      FROM public_reference_article_versions WHERE (reference_id,item_id,revision) IN
      (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?))
      ORDER BY reference_id,item_id,revision`).all(JSON.stringify(headers.map(row => [row.reference_id, row.item_id, row.revision])));
    if (rows.length !== headers.length) throw refused();
    for (let index = 0; index < rows.length; index++) {
      const { snapshot: body, original_snapshot: original, ...header } = rows[index];
      if (canonicalJson(header) !== canonicalJson(headers[index])) throw refused();
      identity(header); timestamp(String(header.collected_at));
      const item_snapshot = text(body), original_snapshot = text(original);
      const item = publicReferenceItemSchema.parse(JSON.parse(item_snapshot)), pointer = pointers.get(versionKey(header));
      // Historical versions have their own real collected_at but no independent
      // article-pointer timestamps. Validate their body/revision, then validate
      // current pointers separately against their actual original header values.
      const projection = { ...header, item_snapshot, original_snapshot, canonical_url: item.link, current_revision: header.revision,
        first_collected_at: header.collected_at, last_collected_at: header.collected_at,
        published_at: item.publishedAt ? timestamp(item.publishedAt) : null,
        sort_at: item.publishedAt ? timestamp(item.publishedAt) : header.collected_at };
      readArticle(projection);
      if (pointer) { readArticle({ ...projection, ...pointer }); retained.add(versionKey(header)); }
      await write({ type: "version", row: { ...header, snapshot: item_snapshot, original_snapshot } });
    }
  }
  if (retained.size !== frozen.articles.length) throw refused();
  const current = snapshot(db, tick);
  const footer = { type: "footer", records, sourceDigest, outputBytesBeforeFooter: outputBytes,
    completedAt: new Date().toISOString(), sourceChangedSinceSnapshot: sha256(canonicalJson(current)) !== metadataDigest };
  await write(footer, true);
  return footer;
}
