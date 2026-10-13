import type { PublicReferenceArticle } from "./archive";

/** Browsing/export projects metadata only; retained bodies cannot leak through object spreading. */
export function publicArticlePreview(item: PublicReferenceArticle) {
  return { id: item.id, referenceId: item.referenceId, title: item.title, summary: item.summary.slice(0, 600),
    link: item.link, ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    deliveryKind: item.deliveryKind, collectionKind: item.collectionKind, contentVersion: item.contentVersion,
    firstCollectedAt: item.firstCollectedAt, lastCollectedAt: item.lastCollectedAt };
}

const queryParameters = [
  { name: "query", in: "query", schema: { type: "string", maxLength: 500 }, description: "Literal words matched against the retained article index." },
  { name: "cursor", in: "query", schema: { type: "string", maxLength: 4096 }, description: "Opaque cursor bound to publisher, query and sort. Changing filters requires a new first page." },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
  { name: "sort", in: "query", schema: { type: "string", enum: ["recent", "oldest", "relevance"], default: "recent" } },
] as const;
const responses = { "200": { description: "Article previews, exact matching total and optional next cursor; no paid body, wallet or creator authority." },
  "400": { description: "Invalid query, page size or mismatched cursor." }, "503": { description: "Archive unavailable on the selected storage profile; no fallback datastore is created." } };
export const publicReferenceArchiveOpenApiPaths = {
  "/api/public-references": { get: { operationId: "browsePublicArticleLibrary", tags: ["Sources"], summary: "Search the cumulative public article library",
    parameters: [...queryParameters, { name: "referenceId", in: "query", schema: { type: "string", pattern: "^public:[a-z0-9-]{1,80}$" } }], responses } },
  "/api/public-references/{id}/items": { get: { operationId: "browsePublisherArticleLibrary", tags: ["Sources"], summary: "Search retained articles from one publisher",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^public:[a-z0-9-]{1,80}$" } }, ...queryParameters], responses } },
};

export function publicArchiveRequest(url: URL, referenceId = url.searchParams.get("referenceId") ?? "") {
  const query = url.searchParams.get("query") ?? "", cursor = url.searchParams.get("cursor") ?? "";
  const rawLimit = url.searchParams.get("limit"), limit = rawLimit === null ? 20 : Number(rawLimit);
  const sort = url.searchParams.get("sort") ?? "recent";
  if (query.length > 500 || cursor.length > 4096 || referenceId && !/^public:[a-z0-9-]{1,80}$/.test(referenceId)
    || rawLimit !== null && !/^[1-9][0-9]*$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || !["recent", "oldest", "relevance"].includes(sort)) throw new Error("Invalid article library request");
  return { query, ...(referenceId ? { referenceId } : {}), ...(cursor ? { cursor } : {}), limit,
    sort: sort as "recent" | "oldest" | "relevance" };
}
