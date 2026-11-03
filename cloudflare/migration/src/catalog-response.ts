import { ManagedCatalog, type CatalogBucket, type CatalogDatabase } from "./managed-catalog";
import { publicArchiveRequest, publicArticlePreview } from "../../../lib/public-references/archive-openapi";

export interface CatalogEnv {
  CATALOG_DB?: CatalogDatabase;
  CATALOG_BLOBS?: CatalogBucket;
  CATALOG_GENERATION?: string;
}

/** Called only AFTER the preview credential/method gate. No bootstrap or writes. */
export async function catalogResponse(request: Request, env: CatalogEnv): Promise<Response> {
  if (!env.CATALOG_DB || !env.CATALOG_BLOBS || !env.CATALOG_GENERATION) {
    return Response.json({ error: "catalog_not_configured", productionReady: false }, { status: 503 });
  }
  const url = new URL(request.url);
  try {
    const catalog = new ManagedCatalog(env.CATALOG_DB, env.CATALOG_BLOBS, env.CATALOG_GENERATION);
    const marker = { deployment: "cloudflare-catalog-preview", generation: env.CATALOG_GENERATION, productionReady: false };
    const inspections = new Map<string, "publishers" | "versions" | "terms">([
      ["/__migration/catalog/verify/publishers", "publishers"], ["/__migration/catalog/verify/versions", "versions"], ["/__migration/catalog/verify/terms", "terms"],
    ]);
    const kind = inspections.get(url.pathname);
    if (kind) {
      if ([...url.searchParams.keys()].some(key => key !== "after") || url.searchParams.getAll("after").length > 1) return Response.json({ error: "invalid_catalog_query" }, { status: 400 });
      return Response.json({ ...marker, inspection: await catalog.inspectPrepared(kind, url.searchParams.get("after") ?? undefined) });
    }
    if (url.pathname === "/__migration/catalog/stats") return Response.json({ ...marker, ...await catalog.publicReferenceArchiveStats() });
    if (url.pathname === "/__migration/catalog/publishers") {
      const publishers = (await catalog.listPublicReferences()).map(({ items: _items, ...metadata }) => metadata);
      return Response.json({ ...marker, publishers });
    }
    if (url.pathname !== "/__migration/catalog") return Response.json({ error: "not_found" }, { status: 404 });
    let query;
    try { query = publicArchiveRequest(url); }
    catch { return Response.json({ error: "invalid_catalog_query" }, { status: 400 }); }
    const page = await catalog.queryPublicReferenceItems(query);
    return Response.json({ ...marker, ...page, items: page.items.map(publicArticlePreview) });
  } catch (error) {
    const invalid = error instanceof Error && "code" in error && ["invalid-query", "invalid-cursor"].includes(String(error.code));
    return Response.json({ error: invalid ? "invalid_catalog_query" : "catalog_unavailable", productionReady: false }, { status: invalid ? 400 : 503 });
  }
}
