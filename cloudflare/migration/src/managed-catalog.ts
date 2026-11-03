import { createHash } from "node:crypto";
import { canonicalJson } from "../../../lib/canonical-json";
import { sourceItemContentVersion } from "../../../lib/sources/source-item-asset";
import { publicReferenceSchema, publicReferenceItemSchema, PUBLIC_FEED_BATCH_ITEMS,
  type PublicReference, type PublicReferenceDb } from "../../../lib/public-references/catalog-contract";
import { archiveSearchTerms, type PublicReferenceItem, type PublicReferenceQuery,
  type PublicReferenceCollectionKind, type PublicReferenceArchiveStats } from "../../../lib/public-references/archive";
import { decodeReference, normalizeItem, timestamp, digest, prefer, readArticle,
  prepareArchiveQuery, finishArchiveQuery, PublicReferenceArchiveError } from "../../../lib/db/public-reference-archive-contract";
import { CATALOG_IDENTITY, CATALOG_SQL } from "./catalog-schema.mjs";
import profile from "./catalog-profile.json" with { type: "json" };

type Value = string | number | null;
interface Statement { bind(...values: Value[]): Statement }
interface Result { success: boolean; results?: Record<string, unknown>[]; error?: string }
interface Session { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<Result[]> }
export interface CatalogDatabase { withSession(constraint: "first-primary"): Session }
export interface CatalogBucket {
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array> } | null>;
  put(key: string, body: string, options: { onlyIf: { etagDoesNotMatch: string };
    httpMetadata: { contentType: string } }): Promise<unknown | null>;
}
type Query = { sql: string; params: Value[] };
type Context = { blobs: Map<string, string>; pending: Map<string, Promise<string>>; bytes: number; deadline: number };
const OBJECT_BYTES = 2 * 1024 * 1024, READ_BYTES = 32 * 1024 * 1024, INPUT_BYTES = 32 * 1024 * 1024;
const keyPattern = /^catalog\/v1\/sha256\/[a-f0-9]{64}$/;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const keyOf = (text: string) => "catalog/v1/sha256/" + sha(text);
const unavailable = () => new PublicReferenceArchiveError("archive-unavailable", "Managed public catalog unavailable");
const context = (): Context => ({ blobs: new Map(), pending: new Map(), bytes: 0, deadline: Date.now() + 15_000 });
const tick = (ctx: Context) => { if (Date.now() > ctx.deadline) throw unavailable(); };
const metadataTables = "s.sql IS NOT NULL AND s.name NOT GLOB 'sqlite_*' AND NOT (s.type='table' AND s.name IN ('_cf_METADATA','_cf_KV','d1_migrations'))";
const expectedSchema = JSON.stringify(profile.objects);

/** An operation's first statement checks compiled schema and identity INSIDE its
 * D1 transaction. Built-in JSON failure aborts the batch before any mutation,
 * even if a target's constraints or triggers were removed. No target DDL repair. */
function guard(generation: string, revision?: number, ready = true): Query {
  return { sql: `SELECT CASE WHEN
    (SELECT count(*) FROM sqlite_schema s WHERE ${metadataTables})=?
    AND NOT EXISTS(SELECT 1 FROM sqlite_schema s LEFT JOIN json_each(?) e ON json_extract(e.value,'$[0]')=s.name
      WHERE ${metadataTables} AND (e.value IS NULL OR s.type IS NOT json_extract(e.value,'$[1]') OR s.sql IS NOT json_extract(e.value,'$[2]')))
    AND EXISTS(SELECT 1 FROM catalog_control WHERE generation=? AND identity=?${ready ? " AND ready=1" : ""}${revision !== undefined ? " AND revision=?" : ""})
    THEN 1 ELSE json_extract('catalog guard refused','$') END AS admitted`,
    params: [profile.objects.length, expectedSchema, generation, CATALOG_IDENTITY, ...(revision !== undefined ? [revision] : [])] };
}

/** Public references have no ownership, price, payout, signing or payment authority.
 * D1 holds metadata; immutable R2 bytes preserve originals beyond D1's row limit.
 * The returned facade exposes no raw SQL, blob access, schema or provisioning. */
export class ManagedCatalog implements PublicReferenceDb {
  readonly #db: CatalogDatabase;
  readonly #bucket: CatalogBucket;
  readonly #generation: string;
  constructor(db: CatalogDatabase, bucket: CatalogBucket, generation: string) {
    if (sha(CATALOG_SQL) !== profile.sourceSha256) throw new Error("Catalog schema source requires profile review");
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(generation)) throw unavailable();
    this.#db = db; this.#bucket = bucket; this.#generation = generation;
  }
  async #batch(queries: Query[]): Promise<Record<string, unknown>[][]> {
    // A NEW primary session for every batch, including the final revision fence.
    // Reusing first-primary's session later could allow a stale replica read.
    const session = this.#db.withSession("first-primary");
    try {
      const results = await session.batch(queries.map(q => session.prepare(q.sql).bind(...q.params)));
      if (results.length !== queries.length || results.some(r => r.success !== true)) throw unavailable();
      return results.map(r => r.results ?? []);
    } catch { throw unavailable(); }
  }
  #control(): Query { return { sql: "SELECT revision,ready FROM catalog_control WHERE generation=?", params: [this.#generation] }; }
  async #read(queries: Query[], ready = true, expected?: number) {
    const result = await this.#batch([guard(this.#generation, expected, ready), this.#control(), ...queries]);
    const revision = result[1][0]?.revision;
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw unavailable();
    return { revision: Number(revision), rows: result.slice(2) };
  }
  async #fence(revision: number, ctx: Context) { tick(ctx); await this.#read([], true, revision); tick(ctx); }
  async #blob(key: unknown, ctx: Context): Promise<string> {
    tick(ctx);
    if (typeof key !== "string" || !keyPattern.test(key)) throw unavailable();
    const cached = ctx.blobs.get(key);
    if (cached !== undefined) return cached;
    const pending = ctx.pending.get(key);
    if (pending) return pending;
    const load = this.#loadBlob(key, ctx);
    ctx.pending.set(key, load);
    try { return await load; } finally { ctx.pending.delete(key); }
  }
  async #loadBlob(key: string, ctx: Context): Promise<string> {
    const object = await this.#bucket.get(key);
    if (!object) throw unavailable();
    if (!Number.isSafeInteger(object.size) || object.size < 1 || object.size > OBJECT_BYTES || ctx.bytes + object.size > READ_BYTES) {
      await object.body.cancel(); throw unavailable();
    }
    // Reserve before reading so concurrent streams share the same hard budget.
    ctx.bytes += object.size;
    const reader = object.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "", bytes = 0;
    try {
      for (;;) {
        tick(ctx); const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > object.size || bytes > OBJECT_BYTES) throw unavailable();
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
      if (bytes !== object.size || keyOf(text) !== key) throw unavailable();
    } catch { await reader.cancel().catch(() => {}); throw unavailable(); }
    finally { reader.releaseLock(); }
    ctx.blobs.set(key, text); return text;
  }
  async #put(text: string, ctx: Context): Promise<string> {
    tick(ctx);
    if (Buffer.byteLength(text) > OBJECT_BYTES) throw unavailable();
    const key = keyOf(text);
    const known = ctx.blobs.get(key);
    if (known !== undefined) { if (known !== text) throw unavailable(); return key; }
    const result = await this.#bucket.put(key, text, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "application/json; charset=utf-8" } });
    // An existing key is never overwritten/repaired. Verify its actual bytes.
    if (result === null && await this.#blob(key, ctx) !== text) throw unavailable();
    ctx.blobs.set(key, text);
    return key;
  }
  async #publisher(row: Record<string, unknown>, ctx: Context): Promise<PublicReference> {
    return decodeReference({ ...row, snapshot: await this.#blob(row.snapshot_key, ctx) });
  }
  async #article(row: Record<string, unknown>, ctx: Context) {
    return readArticle({ ...row, item_snapshot: await this.#blob(row.snapshot_key, ctx), original_snapshot: await this.#blob(row.original_key, ctx) });
  }
  #publisherQuery(id?: string): Query {
    return { sql: `SELECT p.*,(SELECT count(*) FROM public_reference_articles a WHERE a.generation=p.generation AND a.reference_id=p.id) AS archived_item_count
      FROM public_references p WHERE generation=?${id !== undefined ? " AND id=?" : " AND active=1"} ORDER BY id`,
      params: [this.#generation, ...(id !== undefined ? [id] : [])] };
  }
  async listPublicReferences(): Promise<PublicReference[]> {
    const ctx = context(), data = await this.#read([this.#publisherQuery()]);
    const values = await mapBounded(data.rows[0], async row => {
      const value = await this.#publisher(row, ctx);
      return { ...value, items: value.items.slice(0, 10), archivedItemCount: Number(row.archived_item_count) };
    });
    await this.#fence(data.revision, ctx); return values;
  }
  async getPublicReference(id: string): Promise<PublicReference | null> {
    const ctx = context(), data = await this.#read([this.#publisherQuery(id)]), row = data.rows[0][0];
    const value = row ? await this.#publisher(row, ctx) : null;
    await this.#fence(data.revision, ctx);
    return value && { ...value, items: value.items.slice(0, 10), archivedItemCount: Number(row.archived_item_count) };
  }
  async queryPublicReferenceItems(input: PublicReferenceQuery) {
    const plan = prepareArchiveQuery(input, this.#generation), ctx = context();
    const data = await this.#read([plan.total, plan.page]);
    const total = Number(data.rows[0][0]?.n);
    if (!Number.isSafeInteger(total) || total < 0) throw unavailable();
    const rows = data.rows[1];
    await mapBounded(rows.slice(0, plan.limit), async row => {
      const publisher = await this.#publisher({ id: row.publisher_id, active: row.publisher_active,
        rss_url: row.publisher_rss_url, snapshot_key: row.publisher_key }, ctx);
      if (!publisher.active || publisher.id !== row.reference_id) throw unavailable();
      row.item_snapshot = await this.#blob(row.snapshot_key, ctx);
      row.original_snapshot = await this.#blob(row.original_key, ctx);
    });
    const result = finishArchiveQuery(plan, total, rows);
    await this.#fence(data.revision, ctx); return result;
  }
  async publicReferenceArchiveStats(): Promise<PublicReferenceArchiveStats> {
    const data = await this.#read([{ sql: `SELECT count(*) AS articles,count(DISTINCT a.reference_id) AS publishers,
      min(a.published_at) AS oldest,max(a.published_at) AS newest FROM public_reference_articles a
      JOIN public_references p ON p.id=a.reference_id AND p.generation=a.generation WHERE a.generation=? AND p.active=1`, params: [this.#generation] }]);
    const row = data.rows[0][0];
    return { articles: Number(row.articles), publishers: Number(row.publishers),
      ...(row.oldest ? { oldestPublishedAt: String(row.oldest) } : {}), ...(row.newest ? { newestPublishedAt: String(row.newest) } : {}) };
  }
  async upsertPublicReference(input: PublicReference) {
    const value = publicReferenceSchema.parse(input);
    return this.#write(value.id, value.items, "feed", value.refreshedAt ?? new Date().toISOString(), value);
  }
  async archivePublicReferenceItems(id: string, items: PublicReferenceItem[], kind: PublicReferenceCollectionKind,
    observedAt = new Date().toISOString()) {
    publicReferenceSchema.shape.id.parse(id);
    return this.#write(id, items, kind, observedAt);
  }
  /** Private operator READ-ONLY inspection of an initial prepared generation.
   * Does not expose body text, change readiness or admit a financial store.
   * A live application write advances revision and refuses this import audit. */
  async inspectPrepared(kind: "publishers" | "versions" | "terms", after?: string) {
    if (!["publishers", "versions", "terms"].includes(kind)) throw unavailable();
    const keys = kind === "publishers" ? ["id"] : kind === "versions" ? ["reference_id", "item_id", "revision"]
      : ["term", "reference_id", "item_id", "revision"];
    let boundary: string[] = [];
    if (after !== undefined) {
      try {
        if (after.length > 4096 || Buffer.from(after, "base64url").toString("base64url") !== after) throw unavailable();
        const value: unknown = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
        if (!Array.isArray(value) || value.length !== keys.length + 2 || value[0] !== this.#generation || value[1] !== kind
          || !value.slice(2).every(part => typeof part === "string" && part.length <= 100)) throw unavailable();
        boundary = value.slice(2);
      } catch { throw new PublicReferenceArchiveError("invalid-cursor", "Invalid prepared catalog cursor"); }
    }
    const table = { publishers: "public_references", versions: "public_reference_article_versions", terms: "public_reference_article_terms" }[kind];
    const limit = kind === "terms" ? 2048 : 50;
    const clause = boundary.length ? ` AND (${keys.map(key => "t." + key).join(",")})>(${keys.map(() => "?").join(",")})` : "";
    const current = kind === "versions" ? `,(SELECT json_object('canonical_url',a.canonical_url,'current_revision',a.current_revision,
      'first_collected_at',a.first_collected_at,'last_collected_at',a.last_collected_at,'published_at',a.published_at,'sort_at',a.sort_at)
      FROM public_reference_articles a WHERE a.generation=t.generation AND a.reference_id=t.reference_id AND a.item_id=t.item_id AND a.current_revision=t.revision) current_article` : "";
    const ctx = context(), data = await this.#read([{ sql: `SELECT t.*${current} FROM ${table} t WHERE t.generation=?${clause}
      ORDER BY ${keys.map(key => "t." + key).join(",")} LIMIT ?`, params: [this.#generation, ...boundary, limit + 1] }], false, 0);
    const rows = data.rows[0].slice(0, limit);
    await mapBounded(rows, async row => {
      if (kind === "publishers") { await this.#publisher(row, ctx); return; }
      if (kind === "terms") {
        if (typeof row.term !== "string" || row.term.length > 100 || !Number.isInteger(row.weight) || Number(row.weight) < 1 || Number(row.weight) > 9) throw unavailable();
        publicReferenceSchema.shape.id.parse(row.reference_id); publicReferenceItemSchema.shape.id.parse(row.item_id);
        if (typeof row.revision !== "string" || !/^[a-f0-9]{64}$/.test(row.revision)) throw unavailable();
        return;
      }
      const item_snapshot = await this.#blob(row.snapshot_key, ctx), original_snapshot = await this.#blob(row.original_key, ctx);
      const item = publicReferenceItemSchema.parse(JSON.parse(item_snapshot));
      const projection = { ...row, item_snapshot, original_snapshot, current_revision: row.revision, canonical_url: item.link,
        first_collected_at: row.collected_at, last_collected_at: row.collected_at,
        published_at: item.publishedAt ? timestamp(item.publishedAt) : null,
        sort_at: item.publishedAt ? timestamp(item.publishedAt) : row.collected_at };
      readArticle(projection);
      if (row.current_article !== null) {
        if (typeof row.current_article !== "string") throw unavailable();
        row.current_article = JSON.parse(row.current_article);
        readArticle({ ...projection, ...row.current_article as Record<string, unknown> });
      }
    });
    tick(ctx); await this.#read([], false, 0); tick(ctx);
    const last = rows.at(-1);
    return { generation: this.#generation, revision: 0, kind, rows,
      objects: [...ctx.blobs].map(([key, text]) => ({ key, sha256: sha(text), bytes: Buffer.byteLength(text) })),
      ...(data.rows[0].length > limit && last ? { nextCursor: Buffer.from(JSON.stringify([this.#generation, kind, ...keys.map(key => last[key])])).toString("base64url") } : {}) };
  }
  async #stageIndexes(id: string, items: Map<string, PublicReferenceItem>, states: Map<string, { revision: string }>, revision: number, ctx: Context) {
    if (!items.size) return;
    const known = await this.#read([{ sql: `SELECT item_id,revision,terms_count,terms_digest,complete FROM catalog_index_revisions
      WHERE generation=? AND reference_id=? AND (item_id,revision) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))`,
      params: [this.#generation, id, JSON.stringify([...items.keys()].map(itemId => [itemId, states.get(itemId)!.revision]))] }], false, revision);
    const complete = new Map(known.rows[0].map(row => [String(row.item_id), row]));
    let pending: Query[] = [], totalTerms = 0;
    const flush = async () => {
      if (!pending.length) return;
      tick(ctx); await this.#batch([guard(this.#generation, revision, false), ...pending]); pending = [];
    };
    const append = async (query: Query) => { pending.push(query); if (pending.length >= 16) await flush(); };
    for (const item of items.values()) {
      const weights = new Map<string, number>();
      for (const [text, weight] of [[item.title, 6], [item.summary, 2], [item.content, 1]] as const)
        for (const term of archiveSearchTerms(text)) weights.set(term, (weights.get(term) ?? 0) + weight);
      totalTerms += weights.size;
      if (totalTerms > 500_000) throw unavailable();
      const indexDigest = digest([...weights].sort((a, b) => compareUtf8(a[0], b[0])));
      const prior = complete.get(item.id), version = states.get(item.id)!.revision;
      if (prior && (prior.terms_count !== weights.size || prior.terms_digest !== indexDigest)) throw unavailable();
      if (prior?.complete === 1) continue;
      await append({ sql: `INSERT INTO catalog_index_revisions(generation,reference_id,item_id,revision,algorithm,terms_count,terms_digest,complete)
        VALUES (?,?,?,?,'literal-weights-nfkc-v1',?,?,0) ON CONFLICT(generation,reference_id,item_id,revision) DO NOTHING`,
        params: [this.#generation, id, item.id, version, weights.size, indexDigest] });
      for (const rows of jsonBatches([...weights])) await append({ sql: `INSERT INTO public_reference_article_terms(generation,reference_id,item_id,revision,term,weight)
        SELECT ?,?,?,?,${jsonFields(2)} FROM json_each(?) WHERE EXISTS(SELECT 1 FROM catalog_index_revisions i
        WHERE i.generation=? AND i.reference_id=? AND i.item_id=? AND i.revision=? AND i.complete=0)
        ON CONFLICT(generation,term,reference_id,item_id,revision) DO NOTHING`,
        params: [this.#generation, id, item.id, version, rows, this.#generation, id, item.id, version] });
      await append({ sql: `UPDATE catalog_index_revisions SET complete=1 WHERE generation=? AND reference_id=? AND item_id=? AND revision=? AND complete=0
        AND terms_count=(SELECT count(*) FROM public_reference_article_terms t WHERE t.generation=? AND t.reference_id=? AND t.item_id=? AND t.revision=?)`,
        params: [this.#generation, id, item.id, version, this.#generation, id, item.id, version] });
    }
    await flush();
  }
  async #write(id: string, inputs: PublicReferenceItem[], kind: PublicReferenceCollectionKind, observedAt: string, publisher?: PublicReference) {
    if (!Array.isArray(inputs) || inputs.length > PUBLIC_FEED_BATCH_ITEMS || !["feed", "article"].includes(kind)) throw unavailable();
    const collected = timestamp(observedAt), ctx = context();
    const initial = await this.#read([this.#publisherQuery(id)], false), priorRow = initial.rows[0][0];
    const priorPublisher = priorRow ? await this.#publisher(priorRow, ctx) : undefined;
    if (!publisher && !priorPublisher?.active) throw unavailable();
    const groups = [...(publisher && priorPublisher ? [{ items: priorPublisher.items, kind: "feed" as const,
      at: priorPublisher.refreshedAt ?? new Date().toISOString(), counted: false }] : []), { items: inputs, kind, at: collected, counted: true }];
    const versions = groups.flatMap(group => { let inputBytes = 0; return group.items.map(input => {
      const original = canonicalJson(publicReferenceItemSchema.parse(input)), item = normalizeItem(id, input), snapshot = canonicalJson(item);
      inputBytes += Buffer.byteLength(original);
      if (inputBytes > INPUT_BYTES || Buffer.byteLength(original) > OBJECT_BYTES || Buffer.byteLength(snapshot) > OBJECT_BYTES) throw unavailable();
      return { item, original, snapshot, revision: digest({ item, original, kind: group.kind }), kind: group.kind,
        at: timestamp(group.at), counted: group.counted, contentVersion: sourceItemContentVersion({ ...item, sourceId: id }) };
    }); });
    const currentData = await this.#read([{ sql: `SELECT a.*,v.snapshot_key,v.original_key,v.content_version,v.collection_kind
      FROM public_reference_articles a JOIN public_reference_article_versions v ON v.generation=a.generation
      AND v.reference_id=a.reference_id AND v.item_id=a.item_id AND v.revision=a.current_revision
      WHERE a.generation=? AND a.reference_id=? AND a.item_id IN (SELECT value FROM json_each(?))`,
      params: [this.#generation, id, JSON.stringify([...new Set(versions.map(v => v.item.id))])] }], false, initial.revision);
    type Current = { item: PublicReferenceItem; revision: string; first: string; last: string; kind: PublicReferenceCollectionKind };
    const current = new Map<string, Current>(), changed = new Map<string, Current>(), indexes = new Map<string, PublicReferenceItem>();
    await mapBounded(currentData.rows[0], async row => { current.set(String(row.item_id), { item: await this.#article(row, ctx), revision: String(row.current_revision),
      first: String(row.first_collected_at), last: String(row.last_collected_at), kind: row.collection_kind as PublicReferenceCollectionKind }); });
    let added = 0, updated = 0;
    for (const v of versions) {
      const prior = current.get(v.item.id), selected = !prior || prefer(v.item, prior.item, v.kind, prior.kind);
      if (v.counted) { if (!prior) added++; else if (selected && prior.revision !== v.revision) updated++; }
      if (selected && (!prior || prior.revision !== v.revision)) indexes.set(v.item.id, v.item);
      const value: Current = { item: selected ? v.item : prior!.item, revision: selected ? v.revision : prior!.revision,
        first: prior ? [prior.first, v.at].sort()[0] : v.at, last: prior ? [prior.last, v.at].sort().at(-1)! : v.at,
        kind: selected ? v.kind : prior!.kind };
      current.set(v.item.id, value); changed.set(v.item.id, value);
    }
    const queries: Query[] = [guard(this.#generation, initial.revision, false)];
    const objects = new Map<string, string>();
    for (const v of versions) { objects.set(keyOf(v.snapshot), v.snapshot); objects.set(keyOf(v.original), v.original); }
    await mapBounded([...objects.values()], text => this.#put(text, ctx));
    const versionRows: Value[][] = versions.map(v => [id, v.item.id, v.revision, v.contentVersion,
      keyOf(v.snapshot), keyOf(v.original), v.kind, v.at]);
    for (const rows of jsonBatches(versionRows)) queries.push({ sql: `INSERT INTO public_reference_article_versions
      (generation,reference_id,item_id,revision,content_version,snapshot_key,original_key,collection_kind,collected_at)
      SELECT ?,${jsonFields(8)} FROM json_each(?) WHERE 1 ON CONFLICT(generation,reference_id,item_id,revision) DO NOTHING`, params: [this.#generation, rows] });
    const articles = [...changed.values()].map(v => [id, v.item.id, v.item.link, v.revision, v.first, v.last,
      v.item.publishedAt ? timestamp(v.item.publishedAt) : null, v.item.publishedAt ? timestamp(v.item.publishedAt) : v.first]);
    for (const rows of jsonBatches(articles)) queries.push({ sql: `INSERT INTO public_reference_articles
      (generation,reference_id,item_id,canonical_url,current_revision,first_collected_at,last_collected_at,published_at,sort_at)
      SELECT ?,${jsonFields(8)} FROM json_each(?) WHERE 1 ON CONFLICT(generation,reference_id,item_id) DO UPDATE SET
      current_revision=excluded.current_revision,first_collected_at=excluded.first_collected_at,last_collected_at=excluded.last_collected_at,
      published_at=excluded.published_at,sort_at=excluded.sort_at`, params: [this.#generation, rows] });
    await this.#stageIndexes(id, indexes, changed, initial.revision, ctx);
    if (publisher) {
      const { archivedItemCount: _count, ...snapshot } = publisher;
      snapshot.items = [...snapshot.items].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") || a.id.localeCompare(b.id)).slice(0, 10);
      const key = await this.#put(canonicalJson(snapshot), ctx);
      queries.push({ sql: `INSERT INTO public_references(generation,id,active,rss_url,snapshot_key) VALUES (?,?,?,?,?)
        ON CONFLICT(generation,id) DO UPDATE SET active=excluded.active,rss_url=excluded.rss_url,snapshot_key=excluded.snapshot_key`,
        params: [this.#generation, id, Number(publisher.active), publisher.rssUrl, key] });
    }
    tick(ctx);
    queries.push({ sql: "UPDATE catalog_control SET revision=revision+1 WHERE generation=?", params: [this.#generation] });
    await this.#batch(queries); return { added, updated };
  }
}

const jsonFields = (count: number) => Array.from({ length: count }, (_, i) => "json_extract(value,'$[" + i + "]')").join(",");
async function mapBounded<T, R>(values: T[], operation: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = [];
  for (let index = 0; index < values.length; index += 4) result.push(...await Promise.all(values.slice(index, index + 4).map(operation)));
  return result;
}
function jsonBatches(rows: Value[][]): string[] {
  const result: string[] = []; let batch: Value[][] = [], bytes = 2;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row));
    if (size + 2 > 128 * 1024) throw unavailable();
    if (batch.length && (batch.length === 2048 || bytes + size + 1 > 128 * 1024)) { result.push(JSON.stringify(batch)); batch = []; bytes = 2; }
    bytes += size + (batch.length ? 1 : 0); batch.push(row);
  }
  if (batch.length) result.push(JSON.stringify(batch));
  return result;
}

// SQLite BINARY over valid UTF-8 follows code-point order, including astral letters.
function compareUtf8(a: string, b: string): number {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const left = a.codePointAt(i)!, right = b.codePointAt(j)!;
    if (left !== right) return left - right;
    i += left > 0xffff ? 2 : 1; j += right > 0xffff ? 2 : 1;
  }
  return (a.length - i) - (b.length - j);
}

// Pure, source-known request templates for the explicit OFFLINE operator plan.
// These exports carry no database/bucket capability or HTTP mutation route.
export { guard as catalogGuard, jsonBatches as catalogJsonBatches, jsonFields as catalogJsonFields };
