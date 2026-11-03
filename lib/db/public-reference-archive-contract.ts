/** Portable public-only catalog validation and query contract. No datastore, network, wallet or payout capability. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { sourceItemContentVersion } from "../sources/source-item-asset";
import { canonicalPublicArticleUrl, publicReferenceItemId, publicReferenceItemSchema, publicReferenceSchema, type PublicReference } from "../public-references/catalog-contract";
import { archiveSearchTerms, type PublicReferenceArticle, type PublicReferenceCollectionKind, type PublicReferenceItem, type PublicReferencePage, type PublicReferenceQuery } from "../public-references/archive";

export class PublicReferenceArchiveError extends Error {
  constructor(readonly code: "invalid-query" | "invalid-cursor" | "archive-unavailable", message: string) {
    super(message); this.name = "PublicReferenceArchiveError";
  }
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

export function prepareArchiveQuery(input: PublicReferenceQuery, generation?: string) {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) throw new PublicReferenceArchiveError("invalid-query", "Invalid public archive query");
  const query = parsed.data, terms = archiveSearchTerms(query.query ?? "").sort();
  if (terms.length > 32) throw new PublicReferenceArchiveError("invalid-query", "Public archive query has too many terms");
  const hasQuery = Boolean((query.query ?? "").trim());
  const binding = digest({ ...(generation !== undefined ? { generation } : {}), referenceId: query.referenceId ?? null, terms, hasQuery, match: query.match, sort: query.sort,
    order: "known-publication-first-v1" });
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))); }
    catch { throw new PublicReferenceArchiveError("invalid-cursor", "Invalid public archive cursor"); }
    if (cursor.binding !== binding) throw new PublicReferenceArchiveError("invalid-cursor", "Public archive cursor belongs to another query");
  }
  const params: (string | number | null)[] = [], filters = ["p.active=1"];
  if (generation !== undefined) { filters.push("a.generation=?"); params.push(generation); }
  if (query.referenceId) { filters.push("a.reference_id=?"); params.push(query.referenceId); }
  if ((query.query ?? "").trim() && !terms.length) filters.push("0=1");
  let matching = "", score = "0";
  if (terms.length) {
    matching = `JOIN (SELECT ${generation !== undefined ? "generation," : ""}reference_id,item_id,sum(weight) AS score FROM public_reference_article_terms WHERE term IN (${terms.map(() => "?").join(",")})${generation !== undefined ? " AND generation=?" : ""}
      GROUP BY ${generation !== undefined ? "generation," : ""}reference_id,item_id ${query.match === "all" ? "HAVING count(*)=" + terms.length : ""}) AS hits ON hits.reference_id=a.reference_id AND hits.item_id=a.item_id${generation !== undefined ? " AND hits.generation=a.generation" : ""}`;
    if (generation !== undefined) matching = `JOIN (SELECT t.generation,t.reference_id,t.item_id,sum(t.weight) AS score
      FROM public_reference_article_terms t JOIN public_reference_articles current_article ON current_article.generation=t.generation
      AND current_article.reference_id=t.reference_id AND current_article.item_id=t.item_id AND current_article.current_revision=t.revision
      WHERE t.term IN (${terms.map(() => "?").join(",")}) AND t.generation=? GROUP BY t.generation,t.reference_id,t.item_id
      ${query.match === "all" ? "HAVING count(*)=" + terms.length : ""}) AS hits ON hits.generation=a.generation AND hits.reference_id=a.reference_id AND hits.item_id=a.item_id`;
    score = "hits.score";
    params.unshift(...terms, ...(generation !== undefined ? [generation] : []));
  }
  const base = `SELECT a.*,(a.published_at IS NOT NULL) AS has_published,${score} AS score FROM public_reference_articles a JOIN public_references p ON p.id=a.reference_id${generation !== undefined ? " AND p.generation=a.generation" : ""} ${matching} WHERE ${filters.join(" AND ")}`;
  const total = { sql: `SELECT count(*) AS n FROM (${base})`, params: [...params] };
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
  const page = { sql: `WITH candidate AS (${base}) SELECT candidate.*,${generation !== undefined ? "v.snapshot_key,v.original_key,pub.id AS publisher_id,pub.active AS publisher_active,pub.rss_url AS publisher_rss_url,pub.snapshot_key AS publisher_key" : "v.snapshot AS item_snapshot,v.original_snapshot"},v.content_version,v.collection_kind
    FROM candidate JOIN public_reference_article_versions v ON v.reference_id=candidate.reference_id AND v.item_id=candidate.item_id AND v.revision=candidate.current_revision${generation !== undefined ? " AND v.generation=candidate.generation JOIN public_references pub ON pub.id=candidate.reference_id AND pub.generation=candidate.generation" : ""}
    ${boundary} ORDER BY ${query.sort === "relevance" ? "candidate.score DESC," : ""}candidate.has_published DESC,candidate.sort_at ${direction},candidate.reference_id ASC,candidate.item_id ASC LIMIT ?`, params: [...params, query.limit + 1] };
  return { total, page, limit: query.limit, binding };
}

export function finishArchiveQuery(plan: ReturnType<typeof prepareArchiveQuery>, total: number, rows: Record<string, unknown>[]): PublicReferencePage {
  const page = rows.slice(0, plan.limit), last = page.at(-1);
  return { items: page.map(readArticle), total, ...(rows.length > plan.limit && last ? { nextCursor: Buffer.from(canonicalJson({ v: 1, binding: plan.binding,
    score: Number(last.score), hasPublished: Boolean(last.has_published), date: String(last.sort_at), referenceId: String(last.reference_id), itemId: String(last.item_id) })).toString("base64url") } : {}) };
}

export { decodeReference, timestamp, normalizeItem, digest, prefer, readArticle };
