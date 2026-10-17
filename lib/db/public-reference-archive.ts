import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { canonicalPublicArticleUrl, PUBLIC_FEED_BATCH_ITEMS, publicReferenceItemId,
  publicReferenceItemSchema, publicReferenceSchema, type PublicReference } from "../public-references/catalog";
import { archiveSearchTerms, type PublicReferenceArticle, type PublicReferenceArchiveStats,
  type PublicReferenceCollectionKind, type PublicReferenceItem, type PublicReferencePage,
  type PublicReferenceQuery } from "../public-references/archive";
import { sqliteSchemaMatches, type SqliteSchemaExpectation } from "./sqlite-schema-match";
import { STORAGE_SNAPSHOT_LIMITS } from "./storage-identity-snapshot";
import { isVerifiedSqliteConnection, readVerifiedSqliteAllocatedBytes } from "./storage-identity-connection";

export class PublicReferenceArchiveError extends Error {
  constructor(readonly code: "invalid-query" | "invalid-cursor" | "archive-unavailable", message: string) {
    super(message); this.name = "PublicReferenceArchiveError";
  }
}

// Same fixed archive-only bounds as the verified migration/backup reader. These
// are operation capacity, not a truncation limit on the lifetime public library.
export const PUBLIC_REFERENCE_ARCHIVE_WRITE_LIMITS = Object.freeze({ ...STORAGE_SNAPSHOT_LIMITS,
  fileBytes: 256 * 1024 * 1024, rows: 250_000, framedBytes: 128 * 1024 * 1024 });
const TERM_INSERT_ROWS = 256, TERM_INSERT_BYTES = 128 * 1024;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function checkWriteDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw new Error("Public archive write deadline");
}

/** Quantities only: no original TEXT/BLOB leaves SQLite. Match the archive
 * snapshot's typed framing (including hidden rowids), under the writer snapshot. */
function assertWriteCapacity(db: DatabaseSync, deadline: number): void {
  const limits = PUBLIC_REFERENCE_ARCHIVE_WRITE_LIMITS;
  const allocated = isVerifiedSqliteConnection(db) ? readVerifiedSqliteAllocatedBytes(db)
    : Number(db.prepare("PRAGMA page_count").get()!.page_count) * Number(db.prepare("PRAGMA page_size").get()!.page_size);
  if (!Number.isSafeInteger(allocated) || allocated > limits.fileBytes) throw new Error("Public archive write file limit");
  const tables = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name LIMIT ?").all(limits.schemaObjects + 1);
  if (tables.length > limits.schemaObjects) throw new Error("Public archive write schema limit");
  let rows = 0, bytes = 0, framed = 0;
  for (const table of tables) {
    checkWriteDeadline(deadline);
    if (typeof table.name !== "string" || typeof table.sql !== "string") throw new Error("Public archive write schema limit");
    const columns = db.prepare(`PRAGMA table_info(${quote(table.name)})`).all().map(row => String(row.name));
    if (columns.length > limits.columns) throw new Error("Public archive write column limit");
    const rowid = !/\bWITHOUT\s+ROWID\b/i.test(table.sql)
      ? ["_rowid_", "rowid", "oid"].find(name => !columns.some(column => column.toLowerCase() === name)) : undefined;
    if (rowid) columns.unshift(rowid);
    const fields = columns.map(name => {
      const value = quote(name), type = `typeof(${value})`, length = `coalesce(length(CAST(${value} AS BLOB)),0)`;
      const payload = `CASE ${type} WHEN 'text' THEN ${length} WHEN 'blob' THEN 11+2*${length}
        WHEN 'integer' THEN 14+${length} WHEN 'real' THEN 27 WHEN 'null' THEN 8 END`;
      return { raw: length, framed: `(${payload})+length(${type})+2+length(CAST((${payload}) AS TEXT))`,
        invalid: `(${length}>${limits.fieldBytes} OR (${type}='real' AND NOT (${value} BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)))` };
    });
    if (!fields.length) throw new Error("Public archive write column limit");
    const result = db.prepare(`SELECT count(*) AS rows,coalesce(sum(${fields.map(field => field.raw).join("+")}),0) AS bytes,
      coalesce(sum(${fields.map(field => field.framed).join("+")}),0) AS framed,
      coalesce(max(${fields.map(field => field.invalid).join(" OR ")}),0) AS invalid
      FROM (SELECT *${rowid ? `,${quote(rowid)} AS ${quote(rowid)}` : ""} FROM ${quote(table.name)} LIMIT ?)`)
      .get(limits.rows - rows + 1)!;
    rows += Number(result.rows); bytes += Number(result.bytes); framed += Number(result.framed);
    if (result.invalid !== 0 || ![rows, bytes, framed].every(Number.isSafeInteger) ||
      rows > limits.rows || bytes > limits.totalBytes || framed > limits.framedBytes) throw new Error("Public archive write row/byte limit");
  }
  checkWriteDeadline(deadline);
}

/** Additive public-only storage: no price, creator, wallet, payment or registry authority. */
export const PUBLIC_REFERENCE_ARCHIVE_SQL = `
CREATE TABLE IF NOT EXISTS public_reference_articles (
  reference_id TEXT NOT NULL, item_id TEXT NOT NULL, canonical_url TEXT NOT NULL,
  current_revision TEXT NOT NULL, first_collected_at TEXT NOT NULL, last_collected_at TEXT NOT NULL,
  published_at TEXT, sort_at TEXT NOT NULL,
  PRIMARY KEY(reference_id,item_id), UNIQUE(reference_id,canonical_url)
);
CREATE INDEX IF NOT EXISTS public_reference_articles_recent ON public_reference_articles((published_at IS NOT NULL) DESC,sort_at DESC,reference_id,item_id);
CREATE INDEX IF NOT EXISTS public_reference_articles_oldest ON public_reference_articles((published_at IS NOT NULL) DESC,sort_at ASC,reference_id,item_id);
CREATE INDEX IF NOT EXISTS public_reference_articles_publisher ON public_reference_articles(reference_id,(published_at IS NOT NULL) DESC,sort_at DESC,item_id);
CREATE INDEX IF NOT EXISTS public_reference_articles_publisher_oldest ON public_reference_articles(reference_id,(published_at IS NOT NULL) DESC,sort_at ASC,item_id);
CREATE TABLE IF NOT EXISTS public_reference_article_versions (
  reference_id TEXT NOT NULL, item_id TEXT NOT NULL, revision TEXT NOT NULL,
  content_version TEXT NOT NULL, snapshot TEXT NOT NULL, original_snapshot TEXT NOT NULL,
  collection_kind TEXT NOT NULL CHECK(collection_kind IN ('feed','article')), collected_at TEXT NOT NULL,
  PRIMARY KEY(reference_id,item_id,revision)
);
CREATE TRIGGER IF NOT EXISTS public_reference_versions_immutable BEFORE UPDATE ON public_reference_article_versions
  BEGIN SELECT RAISE(ABORT,'public article version is immutable'); END;
CREATE TRIGGER IF NOT EXISTS public_reference_versions_retained BEFORE DELETE ON public_reference_article_versions
  BEGIN SELECT RAISE(ABORT,'public article version is retained'); END;
CREATE TABLE IF NOT EXISTS public_reference_article_terms (
  term TEXT NOT NULL, reference_id TEXT NOT NULL, item_id TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK(weight > 0), PRIMARY KEY(term,reference_id,item_id)
);
CREATE INDEX IF NOT EXISTS public_reference_article_terms_item ON public_reference_article_terms(reference_id,item_id);
`;

let expectedSchema: readonly SqliteSchemaExpectation[] | undefined;
/** Inspection only. A missing/modified domain never triggers runtime DDL. */
export function hasPublicReferenceArchive(db: DatabaseSync): boolean {
  if (!expectedSchema) {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec(PUBLIC_REFERENCE_ARCHIVE_SQL);
      expectedSchema = reference.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all()
        .map(row => [String(row.name), row.type as "table" | "index" | "trigger", String(row.sql)] as const);
    } finally { reference.close(); }
  }
  return sqliteSchemaMatches(db, expectedSchema);
}
function requireArchive(db: DatabaseSync): void {
  if (!hasPublicReferenceArchive(db)) throw new PublicReferenceArchiveError("archive-unavailable", "Public article archive unavailable; explicit schema migration required");
}
export function publicReferenceArchiveTransaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("SAVEPOINT public_reference_archive");
  try { const result = operation(); db.exec("RELEASE public_reference_archive"); return result; }
  catch (error) { db.exec("ROLLBACK TO public_reference_archive; RELEASE public_reference_archive"); throw error; }
}

/** Explicit installer only. Enrolled stores also require reviewed fences/profile reenrollment. */
export function installPublicReferenceArchive(db: DatabaseSync): void {
  publicReferenceArchiveTransaction(db, () => {
    const existing = db.prepare("SELECT 1 FROM sqlite_schema WHERE name LIKE 'public_reference_article%' OR name LIKE 'public_reference_versions_%' LIMIT 1").get();
    if (existing && !hasPublicReferenceArchive(db)) throw new Error("Public article archive schema differs; refusing repair");
    db.exec(PUBLIC_REFERENCE_ARCHIVE_SQL);
    requireArchive(db);
    // Stream legacy snapshots one publisher at a time; there is no lifetime/publisher cap.
    for (const row of db.prepare("SELECT id,active,rss_url,snapshot FROM public_references ORDER BY id").iterate()) {
      const reference = decodeReference(row);
      writeItems(db, reference.id, reference.items, "feed", reference.refreshedAt ?? new Date().toISOString());
    }
  });
}

function decodeReference(row: Record<string, unknown>): PublicReference {
  const value = publicReferenceSchema.parse(JSON.parse(String(row.snapshot)));
  if (row.id !== value.id || row.active !== Number(value.active) || row.rss_url !== value.rssUrl)
    throw new Error("Public publisher snapshot identity differs");
  return value;
}
function timestamp(value: string): string {
  z.string().datetime().parse(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid archive collection date");
  return date.toISOString();
}
function normalizeItem(referenceId: string, input: PublicReferenceItem): PublicReferenceItem {
  const original = publicReferenceItemSchema.parse(input);
  const canonical = canonicalPublicArticleUrl(original.link);
  if (!canonical) throw new Error("Invalid public article URL");
  const id = publicReferenceItemId(referenceId, canonical);
  // Older snapshots hashed their raw link. Retain those exact bytes in original_snapshot.
  const legacyId = `public-item:${createHash("sha256").update(`${referenceId}\n${original.link}`).digest("hex")}`;
  if (original.id !== id && original.id !== legacyId) throw new Error("Public article item identity differs");
  return { ...original, id, link: canonical };
}
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const quality = { metadata_only: 0, abstract: 1, excerpt: 2, full_text: 3 } as const;
function prefer(next: PublicReferenceItem, prior: PublicReferenceItem,
  kind: PublicReferenceCollectionKind, priorKind: PublicReferenceCollectionKind): boolean {
  // Feed delivery labels describe the feed payload, not the completeness of an
  // independently recovered page. They cannot truncate a retained page body.
  if (kind === "feed" && priorKind === "article" && next.content.length < prior.content.length) return false;
  if (kind === "article" && priorKind === "feed" && next.content.length > prior.content.length) return true;
  if (quality[next.deliveryKind] !== quality[prior.deliveryKind]) return quality[next.deliveryKind] > quality[prior.deliveryKind];
  // An abridged refresh cannot replace an already retained original body.
  return next.content.length >= prior.content.length;
}
function indexItem(db: DatabaseSync, referenceId: string, item: PublicReferenceItem, deadline: number): void {
  db.prepare("DELETE FROM public_reference_article_terms WHERE reference_id=? AND item_id=?").run(referenceId, item.id);
  const terms = new Map<string, number>();
  for (const [text, weight] of [[item.title, 6], [item.summary, 2], [item.content, 1]] as const)
    for (const term of archiveSearchTerms(text)) terms.set(term, (terms.get(term) ?? 0) + weight);
  const insert = db.prepare(`INSERT INTO public_reference_article_terms(term,reference_id,item_id,weight)
    SELECT json_extract(value,'$[0]'),?,?,json_extract(value,'$[1]') FROM json_each(?)`);
  let batch: [string, number][] = [];
  const flush = () => {
    checkWriteDeadline(deadline);
    const encoded = JSON.stringify(batch);
    if (Buffer.byteLength(encoded) > TERM_INSERT_BYTES) throw new Error("Public archive term batch byte limit");
    insert.run(referenceId, item.id, encoded);
    batch = [];
  };
  for (const term of terms) { batch.push(term); if (batch.length === TERM_INSERT_ROWS) flush(); }
  if (batch.length) flush();
}

function writeItems(db: DatabaseSync, referenceId: string, inputs: PublicReferenceItem[],
  kind: PublicReferenceCollectionKind, observedAt: string, deadline = Date.now() + PUBLIC_REFERENCE_ARCHIVE_WRITE_LIMITS.deadlineMs): { added: number; updated: number } {
  if (!Array.isArray(inputs) || inputs.length > PUBLIC_FEED_BATCH_ITEMS) throw new Error("Public article batch exceeds processing capacity");
  if (kind !== "feed" && kind !== "article") throw new Error("Invalid public article collection kind");
  const collectedAt = timestamp(observedAt);
  let bytes = 0, added = 0, updated = 0;
  for (const input of inputs) {
    checkWriteDeadline(deadline);
    const item = normalizeItem(referenceId, input), original = canonicalJson(publicReferenceItemSchema.parse(input));
    bytes += Buffer.byteLength(original);
    if (bytes > 32 * 1024 * 1024) throw new Error("Public article batch exceeds processing byte capacity");
    const snapshot = canonicalJson(item), contentVersion = sourceItemContentVersion({ ...item, sourceId: referenceId });
    const revision = digest({ item, original, kind });
    const prior = db.prepare(`SELECT a.*,v.snapshot,v.collection_kind FROM public_reference_articles a
      JOIN public_reference_article_versions v ON v.reference_id=a.reference_id AND v.item_id=a.item_id AND v.revision=a.current_revision
      WHERE a.reference_id=? AND a.item_id=?`).get(referenceId, item.id);
    db.prepare(`INSERT INTO public_reference_article_versions(reference_id,item_id,revision,content_version,snapshot,original_snapshot,collection_kind,collected_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(reference_id,item_id,revision) DO NOTHING`)
      .run(referenceId, item.id, revision, contentVersion, snapshot, original, kind, collectedAt);
    if (prior && !["feed", "article"].includes(String(prior.collection_kind))) throw new Error("Public archived article provenance differs");
    const selected = !prior || prefer(item, publicReferenceItemSchema.parse(JSON.parse(String(prior.snapshot))),
      kind, prior.collection_kind as PublicReferenceCollectionKind);
    if (!prior) {
      db.prepare(`INSERT INTO public_reference_articles(reference_id,item_id,canonical_url,current_revision,first_collected_at,last_collected_at,published_at,sort_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(referenceId, item.id, item.link, revision, collectedAt, collectedAt,
          item.publishedAt ? timestamp(item.publishedAt) : null, item.publishedAt ? timestamp(item.publishedAt) : collectedAt);
      added++;
    } else {
      const changed = selected && prior.current_revision !== revision;
      const firstCollectedAt = [collectedAt, String(prior.first_collected_at)].sort()[0]!;
      const publishedAt = selected ? item.publishedAt ? timestamp(item.publishedAt) : null : prior.published_at as SQLInputValue;
      db.prepare(`UPDATE public_reference_articles SET last_collected_at=max(last_collected_at,?),
        first_collected_at=min(first_collected_at,?),current_revision=?,published_at=?,sort_at=? WHERE reference_id=? AND item_id=?`)
        .run(collectedAt, collectedAt, selected ? revision : String(prior.current_revision),
          publishedAt, publishedAt ?? firstCollectedAt, referenceId, item.id);
      if (changed) updated++;
    }
    if (selected && (!prior || prior.current_revision !== revision)) indexItem(db, referenceId, item, deadline);
  }
  return { added, updated };
}

export function archiveSqlitePublicReferenceItems(db: DatabaseSync, referenceId: string, items: PublicReferenceItem[],
  kind: PublicReferenceCollectionKind, observedAt = new Date().toISOString()): { added: number; updated: number } {
  requireArchive(db);
  const deadline = Date.now() + PUBLIC_REFERENCE_ARCHIVE_WRITE_LIMITS.deadlineMs;
  return publicReferenceArchiveTransaction(db, () => {
    const row = db.prepare("SELECT id,active,rss_url,snapshot FROM public_references WHERE id=?").get(referenceId);
    if (!row || !decodeReference(row).active) throw new Error("Active public publisher required");
    const result = writeItems(db, referenceId, items, kind, observedAt, deadline);
    assertWriteCapacity(db, deadline);
    return result;
  });
}

export function upsertSqlitePublicReference(db: DatabaseSync, input: PublicReference): { added: number; updated: number } {
  requireArchive(db);
  const value = publicReferenceSchema.parse(input);
  const deadline = Date.now() + PUBLIC_REFERENCE_ARCHIVE_WRITE_LIMITS.deadlineMs;
  return publicReferenceArchiveTransaction(db, () => {
    const prior = db.prepare("SELECT id,active,rss_url,snapshot FROM public_references WHERE id=?").get(value.id);
    if (prior) {
      const original = decodeReference(prior);
      writeItems(db, original.id, original.items, "feed", original.refreshedAt ?? new Date().toISOString(), deadline);
    }
    const result = writeItems(db, value.id, value.items, "feed", value.refreshedAt ?? new Date().toISOString(), deadline);
    const { archivedItemCount: _count, ...snapshot } = value;
    snapshot.items = [...snapshot.items].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.id.localeCompare(b.id)).slice(0, 10);
    db.prepare(`INSERT INTO public_references(id,active,rss_url,snapshot) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET active=excluded.active,rss_url=excluded.rss_url,snapshot=excluded.snapshot`)
      .run(value.id, Number(value.active), value.rssUrl, JSON.stringify(snapshot));
    assertWriteCapacity(db, deadline);
    return result;
  });
}

export function readSqlitePublicReference(db: DatabaseSync, row: Record<string, unknown>): PublicReference {
  const value = decodeReference(row);
  return { ...value, items: value.items.slice(0, 10), ...(hasPublicReferenceArchive(db)
    ? { archivedItemCount: Number(db.prepare("SELECT count(*) AS n FROM public_reference_articles WHERE reference_id=?").get(value.id)!.n) } : {}) };
}

const querySchema = z.object({ referenceId: publicReferenceSchema.shape.id.optional(), query: z.string().max(1000).optional(),
  cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(100).default(25),
  match: z.enum(["all", "any"]).default("all"), sort: z.enum(["recent", "oldest", "relevance"]).default("recent") }).strict();
const cursorSchema = z.object({ v: z.literal(1), binding: z.string().regex(/^[a-f0-9]{64}$/),
  score: z.number().int().nonnegative(), hasPublished: z.boolean(), date: z.string().datetime(), referenceId: publicReferenceSchema.shape.id,
  itemId: publicReferenceItemSchema.shape.id }).strict();
function readArticle(row: Record<string, unknown>): PublicReferenceArticle {
  const item = publicReferenceItemSchema.parse(JSON.parse(String(row.item_snapshot)));
  const original = publicReferenceItemSchema.parse(JSON.parse(String(row.original_snapshot)));
  if (item.id !== row.item_id || item.link !== row.canonical_url || item.id !== publicReferenceItemId(String(row.reference_id), item.link)
    || canonicalJson(item) !== canonicalJson(normalizeItem(String(row.reference_id), original))
    || sourceItemContentVersion({ ...item, sourceId: String(row.reference_id) }) !== row.content_version
    || digest({ item, original: canonicalJson(original), kind: row.collection_kind }) !== row.current_revision
    || !["feed", "article"].includes(String(row.collection_kind))
    || row.published_at !== (item.publishedAt ? timestamp(item.publishedAt) : null)
    || row.sort_at !== (item.publishedAt ? timestamp(item.publishedAt) : row.first_collected_at)) throw new Error("Public archived article provenance differs");
  return { ...item, referenceId: String(row.reference_id), firstCollectedAt: timestamp(String(row.first_collected_at)),
    lastCollectedAt: timestamp(String(row.last_collected_at)), contentVersion: String(row.content_version),
    collectionKind: row.collection_kind as PublicReferenceCollectionKind };
}

export function querySqlitePublicReferenceItems(db: DatabaseSync, input: PublicReferenceQuery): PublicReferencePage {
  requireArchive(db);
  // Count, keyset page and publisher provenance share one read snapshot even
  // when a backfill writer is adding articles concurrently.
  return publicReferenceArchiveTransaction(db, () => queryArchive(db, input));
}
function queryArchive(db: DatabaseSync, input: PublicReferenceQuery): PublicReferencePage {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new PublicReferenceArchiveError("invalid-query", "Invalid public archive query");
  const query = parsed.data, terms = archiveSearchTerms(query.query ?? "").sort();
  if (terms.length > 32) throw new PublicReferenceArchiveError("invalid-query", "Public archive query has too many terms");
  const hasQuery = Boolean((query.query ?? "").trim());
  const binding = digest({ referenceId: query.referenceId ?? null, terms, hasQuery, match: query.match, sort: query.sort,
    order: "known-publication-first-v1" });
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
    catch { throw new PublicReferenceArchiveError("invalid-cursor", "Invalid public archive cursor"); }
    if (cursor.binding !== binding) throw new PublicReferenceArchiveError("invalid-cursor", "Public archive cursor belongs to another query");
  }
  const params: SQLInputValue[] = [], filters = ["p.active=1"];
  if (query.referenceId) { filters.push("a.reference_id=?"); params.push(query.referenceId); }
  if ((query.query ?? "").trim() && !terms.length) filters.push("0=1");
  let matching = "", score = "0";
  if (terms.length) {
    matching = `JOIN (SELECT reference_id,item_id,sum(weight) AS score FROM public_reference_article_terms WHERE term IN (${terms.map(() => "?").join(",")})
      GROUP BY reference_id,item_id ${query.match === "all" ? "HAVING count(*)=" + terms.length : ""}) AS hits ON hits.reference_id=a.reference_id AND hits.item_id=a.item_id`;
    score = "hits.score";
    params.unshift(...terms);
  }
  const base = `SELECT a.*,(a.published_at IS NOT NULL) AS has_published,${score} AS score FROM public_reference_articles a JOIN public_references p ON p.id=a.reference_id ${matching} WHERE ${filters.join(" AND ")}`;
  const total = Number(db.prepare(`SELECT count(*) AS n FROM (${base})`).get(...params)!.n);
  const direction = query.sort === "oldest" ? "ASC" : "DESC", op = direction === "ASC" ? ">" : "<";
  let boundary = "";
  if (cursor) {
    const dateTie = `(candidate.sort_at ${op} ? OR (candidate.sort_at=? AND (candidate.reference_id>? OR (candidate.reference_id=? AND candidate.item_id>?))))`;
    const tie = `(candidate.has_published<? OR (candidate.has_published=? AND ${dateTie}))`;
    boundary = query.sort === "relevance" ? `WHERE (candidate.score<? OR (candidate.score=? AND ${tie}))` : `WHERE ${tie}`;
    if (query.sort === "relevance") params.push(cursor.score, cursor.score);
    params.push(Number(cursor.hasPublished), Number(cursor.hasPublished));
    params.push(cursor.date, cursor.date, cursor.referenceId, cursor.referenceId, cursor.itemId);
  }
  const rows = db.prepare(`WITH candidate AS (${base}) SELECT candidate.*,v.snapshot AS item_snapshot,v.original_snapshot,v.content_version,v.collection_kind
    FROM candidate JOIN public_reference_article_versions v ON v.reference_id=candidate.reference_id AND v.item_id=candidate.item_id AND v.revision=candidate.current_revision
    ${boundary} ORDER BY ${query.sort === "relevance" ? "candidate.score DESC," : ""}candidate.has_published DESC,candidate.sort_at ${direction},candidate.reference_id ASC,candidate.item_id ASC LIMIT ?`)
    .all(...params, query.limit + 1);
  const page = rows.slice(0, query.limit), last = page.at(-1);
  for (const referenceId of new Set(page.map(row => String(row.reference_id)))) {
    const publisher = db.prepare("SELECT id,active,rss_url,snapshot FROM public_references WHERE id=?").get(referenceId);
    if (!publisher || !decodeReference(publisher).active) throw new Error("Public archived publisher provenance differs");
  }
  return { items: page.map(readArticle), total, ...(rows.length > query.limit && last ? { nextCursor: Buffer.from(canonicalJson({ v: 1, binding,
    score: Number(last.score), hasPublished: Boolean(last.has_published), date: String(last.sort_at), referenceId: String(last.reference_id), itemId: String(last.item_id) })).toString("base64url") } : {}) };
}

export function sqlitePublicReferenceArchiveStats(db: DatabaseSync): PublicReferenceArchiveStats {
  requireArchive(db);
  const row = db.prepare(`SELECT count(*) AS articles,count(DISTINCT a.reference_id) AS publishers,min(a.published_at) AS oldest,max(a.published_at) AS newest
    FROM public_reference_articles a JOIN public_references p ON p.id=a.reference_id WHERE p.active=1`).get()!;
  return { articles: Number(row.articles), publishers: Number(row.publishers),
    ...(row.oldest ? { oldestPublishedAt: String(row.oldest) } : {}), ...(row.newest ? { newestPublishedAt: String(row.newest) } : {}) };
}
