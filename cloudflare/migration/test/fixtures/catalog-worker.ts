// TEST ONLY: bundled independently into an isolated Miniflare worker. Never deployed.
import { ManagedCatalog, type CatalogBucket, type CatalogDatabase } from "../../src/managed-catalog";

interface Env { DB: CatalogDatabase & { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } } }; BLOBS: CatalogBucket }
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url), generation = url.searchParams.get("generation") ?? "fixture";
    let bucket = env.BLOBS;
    if (["/race-read", "/race-write", "/race-schema", "/fail-blobs"].includes(url.pathname)) {
      let injected = false;
      let puts = 0;
      const mutate = async () => {
        if (injected) return; injected = true;
        if (url.pathname === "/race-schema") await env.DB.prepare("DROP TRIGGER public_reference_versions_immutable").bind().run();
        else await env.DB.prepare("UPDATE catalog_control SET revision=revision+1 WHERE generation=?").bind(generation).run();
      };
      bucket = {
        get: async key => { const object = await env.BLOBS.get(key); if (url.pathname === "/race-read") await mutate(); return object; },
        put: async (key, body, options) => {
          if (url.pathname === "/fail-blobs" && ++puts === 2) throw new Error("Injected blob failure");
          const object = await env.BLOBS.put(key, body, options);
          if (url.pathname === "/race-write" || url.pathname === "/race-schema") await mutate(); return object;
        },
      };
    }
    let database: CatalogDatabase = env.DB;
    if (url.pathname === "/fail-index") {
      let batches = 0;
      database = { withSession: constraint => {
        const session = env.DB.withSession(constraint), termWrites = new Set<unknown>();
        return { prepare: sql => ({ bind: (...values) => {
          const statement = session.prepare(sql).bind(...values);
          if (sql.startsWith("INSERT INTO public_reference_article_terms")) termWrites.add(statement);
          return statement;
        } }), batch: statements => {
          if (statements.some(statement => termWrites.has(statement)) && ++batches === 2) throw new Error("Injected staged index failure");
          return session.batch(statements);
        } };
      } };
    }
    const catalog = new ManagedCatalog(database, bucket, generation);
    try {
      const body = request.method === "POST" ? await request.json() as Record<string, unknown> : {};
      let value;
      if (["/upsert", "/race-write", "/race-schema", "/fail-blobs", "/fail-index"].includes(url.pathname)) value = await catalog.upsertPublicReference(body as never);
      else if (url.pathname === "/archive") value = await catalog.archivePublicReferenceItems(body.id as string, body.items as never, body.kind as never, body.observedAt as string);
      else if (url.pathname === "/list") value = await catalog.listPublicReferences();
      else if (url.pathname === "/get") value = await catalog.getPublicReference(url.searchParams.get("id")!);
      else if (url.pathname === "/stats") value = await catalog.publicReferenceArchiveStats();
      else value = await catalog.queryPublicReferenceItems(body as never);
      return Response.json(value, { headers: { "X-Test-Fixture": "catalog-only" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "failed",
        code: typeof error === "object" && error !== null && "code" in error ? error.code : "refused" }, { status: 503 });
    }
  },
};
