import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { isConfiguredSameOrigin } from "../auth-origin";
import { PAPER_CATALOG } from "../papers/catalog";
import { controlTopicWatch, createTopicWatch, runTopicWatchCheck, topicWatchSpecSchema, updateTopicWatch,
  type TopicWatchDependencies, type TopicWatchMetadataPort, type TopicWatchResult } from "./topic-watches";
import type { TopicWatchSession } from "../db/topic-watches-sqlite";

export type TopicWatchAccountContext = { db: KeryxDB; wallet: string; currentId: string };
export type TopicWatchAccountSession = () => Promise<TopicWatchAccountContext | Response>;
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const actionSchema = z.object({ action: z.enum(["check", "pause", "resume", "cancel"]) }).strict();

/** Bounded existing local scholarly metadata only. Deliberately does not import
 * the search module (which also contains live provider reachability). This
 * compares a curated snapshot, never claims completeness of the literature. */
export const localTopicWatchMetadata: TopicWatchMetadataPort = Object.freeze({
  async read(request, signal) {
    if (signal?.aborted || Date.now() >= request.deadlineAtMs) throw new Error("Metadata window ended");
    if (!Number.isInteger(request.maximumRows) || request.maximumRows < 1 || request.maximumRows > 32) throw new Error("Metadata bound");
    const fold = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
    const rows = PAPER_CATALOG.filter(record =>
      request.keywords.some(term => fold(record.title).includes(fold(term))) &&
      (!request.authors.length || request.authors.some(term => record.authors.some(name => fold(name) === fold(term)))) &&
      (!request.venues.length || request.venues.some(term => record.venue !== undefined && fold(record.venue) === fold(term))))
      .slice(0, request.maximumRows).map(record => ({ state: "observed" as const, record }));
    return { version: 1, scope: "metadata-only", status: rows.length ? "available" : "empty", complete: true, rows };
  },
} satisfies TopicWatchMetadataPort);

async function boundedBody(req: Request): Promise<unknown> {
  if (!req.body || !/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type") ?? "")) throw new Error("JSON required");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    reject(new Error("Body deadline")); void reader.cancel().catch(() => undefined);
  }, 5000); });
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), deadline]); if (item.done) break;
      size += item.value.length; if (size > 16_384) throw new Error("Body limit"); chunks.push(item.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Original verified session AND selected DB remain fixed across every await.
 * A later valid login for the same wallet is a different authority. The native
 * store additionally rechecks the exact captured row inside the CAS transaction. */
async function dependencies(session: TopicWatchAccountSession, original: TopicWatchAccountContext) {
  let live = true;
  const assertCurrent = async () => {
    if (!live) throw new Error("Session changed");
    try {
      const current = await session();
      if (current instanceof Response || current.db !== original.db || current.wallet !== original.wallet || current.currentId !== original.currentId)
        throw new Error("Session changed");
    } catch (error) { live = false; throw error; }
  };
  const row = await original.db.getWebSession(original.currentId);
  await assertCurrent();
  if (!row || row.hash !== original.currentId || row.wallet !== original.wallet || row.issuedAt > Date.now() || row.expiresAt <= Date.now())
    throw new Error("Session unavailable");
  const captured: TopicWatchSession = { hash: row.hash, wallet: row.wallet, issuedAt: row.issuedAt, expiresAt: row.expiresAt };
  const port = original.db.topicWatches;
  if (!port) throw new Error("Watch storage unavailable");
  const store = port.bindSession(captured);
  async function guarded<T>(operation: () => Promise<T>) {
    await assertCurrent();
    const value = await operation();
    await assertCurrent();
    return value;
  }
  const deps: TopicWatchDependencies = {
    now: Date.now, isOwnerCurrent: wallet => live && wallet === original.wallet && Date.now() < captured.expiresAt,
    store: { read: key => guarded(() => store.read(key)),
      compareAndSwap: (key, revision, next, deadline) => guarded(() => store.compareAndSwap(key, revision, next, deadline)) },
    metadata: { read: (request, signal) => guarded(() => localTopicWatchMetadata.read(request, signal)) },
  };
  return { deps, list: () => guarded(() => store.list()), assertCurrent };
}

function resultStatus(result: TopicWatchResult) {
  return result.status === "conflict" || result.status === "overlap" ? 409 : result.status === "refused"
    ? result.code === "not-found" ? 404 : result.code === "dependency-unavailable" || result.code === "owner-unavailable" ? 503 : 422 : 200;
}
export function createTopicWatchManagement(session: TopicWatchAccountSession, baseUrl: unknown) {
  async function execute(req: Request, operation: "list" | "read" | "create" | "update" | "action" | "cancel", id?: string) {
    try {
      if (new URL(req.url).search || id !== undefined && !idSchema.safeParse(id).success) return json({ error: "invalid_watch" }, 400);
      if (req.headers.has("authorization")) return json({ error: "session_required" }, 401);
      const expectedWallet = req.headers.get("x-keryx-expected-wallet");
      if (!expectedWallet) return json({ error: "owner_precondition_required" }, 428);
      if (!/^0x[0-9a-fA-F]{40}$/.test(expectedWallet)) return json({ error: "invalid_owner_precondition" }, 400);
      if ((req.headers.has("origin") || !["list", "read"].includes(operation)) && !isConfiguredSameOrigin(req, baseUrl))
        return json({ error: "same_origin_required" }, 403);
      const context = await session();
      if (context instanceof Response) return new Response(context.body, { status: context.status, headers });
      if (context.wallet !== expectedWallet.toLowerCase()) return json({ error: "watch_owner_changed" }, 409);
      const bound = await dependencies(session, context);
      const key = { ownerWallet: context.wallet, watchId: id! };
      if (operation === "list") return json({ watches: await bound.list(), metadataSource: "local-curated-catalog", spendMicroUsdc: 0 });
      if (operation === "read") {
        const watch = await bound.deps.store.read(key);
        return watch ? json({ watch }) : json({ error: "watch_not_found" }, 404);
      }
      let revision: number | undefined;
      if (operation !== "create") {
        const match = req.headers.get("if-match")?.match(/^"([1-9]\d{0,15})"$/);
        revision = match ? Number(match[1]) : undefined;
        if (!Number.isSafeInteger(revision) || !revision) return json({ error: "revision_precondition_required" }, 428);
      }
      let result: TopicWatchResult;
      if (operation === "cancel") result = await controlTopicWatch(bound.deps, key, "cancelled", revision);
      else {
        let raw: unknown;
        try { raw = await boundedBody(req); } catch { return json({ error: "invalid_watch" }, 400); }
        await bound.assertCurrent();
        if (operation === "create" || operation === "update") {
          const spec = topicWatchSpecSchema.safeParse(raw);
          if (!spec.success) return json({ error: "invalid_watch" }, 400);
          // Requested money remains unavailable; this manual product accepts zero caps only.
          if (spec.data.requestedCaps.perCheckMicroUsdc !== 0 || spec.data.requestedCaps.perPeriodMicroUsdc !== 0)
            return json({ error: "standing_spend_withheld" }, 422);
          result = operation === "create" ? await createTopicWatch(bound.deps, context.wallet, spec.data)
            : await updateTopicWatch(bound.deps, key, spec.data, revision!);
        } else {
          const action = actionSchema.safeParse(raw);
          if (!action.success) return json({ error: "invalid_watch_action" }, 400);
          result = action.data.action === "check" ? await runTopicWatchCheck(bound.deps, key, req.signal, revision)
            : await controlTopicWatch(bound.deps, key, action.data.action === "resume" ? "active"
              : action.data.action === "pause" ? "paused" : "cancelled", revision);
        }
      }
      await bound.assertCurrent();
      return json({ result }, result.status === "created" ? 201 : resultStatus(result));
    } catch { return json({ error: "watch_unavailable" }, 503); }
  }
  return { list: (req: Request) => execute(req, "list"), create: (req: Request) => execute(req, "create"),
    read: (req: Request, id: string) => execute(req, "read", id), update: (req: Request, id: string) => execute(req, "update", id),
    action: (req: Request, id: string) => execute(req, "action", id), cancel: (req: Request, id: string) => execute(req, "cancel", id) };
}
