import { createHash, timingSafeEqual } from "node:crypto";
import type { KeryxDB } from "../db/keryx-db";
import type { SourceUpkeepSummary } from "../db/source-upkeep";
import { fetchPublicText } from "../net/public-fetch";
import { storeSourceItems } from "../sources/store-source-item";
import { refreshSourceFeed } from "./refresh-feed";
import { ingestRssXml, type IngestedFeed } from "./rss";

export const SOURCE_UPKEEP_JOB_MS = 45_000;
export const SOURCE_UPKEEP_FEED_BYTES = 500_000;

export function sourceUpkeepAuthorized(request: Request, token: string | undefined): boolean {
  // Unconfigured or weak credentials leave the route dark. Hashing fixes comparison length.
  if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 160) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${token}`));
}

type UpkeepDb = Pick<KeryxDB, "getSource" | "getItems" | "addItems" | "setCached" |
  "claimSourceUpkeep" | "finishSourceUpkeep">;

/** Node/Next can represent a bodyless POST as an empty stream. Read only enough to
 * prove emptiness, with a separate deadline so an authenticated slow body cannot hold a job. */
async function emptyRequestBody(request: Request): Promise<boolean> {
  if (request.body === null) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        for (let chunks = 0; chunks < 16; chunks++) {
          const result = await reader.read();
          if (result.done) return true;
          if (result.value.byteLength > 0) return false;
        }
        return false;
      })(),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 1_000); }),
    ]);
  } catch { return false; }
  finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

async function boundedIngest(url: string): Promise<IngestedFeed> {
  const xml = await fetchPublicText(url, {
    timeoutMs: 12_000, maxBytes: SOURCE_UPKEEP_FEED_BYTES, maxHops: 3,
  });
  return ingestRssXml(xml, url, 10);
}

/** CF only wakes this job. Feed URLs, plaintext, encryption keys and DB writes stay on the VPS.
 * Errors returned to the caller are counts, never content or network error strings. */
export async function runSourceUpkeep(
  db: UpkeepDb,
  options: { now?: () => number; ingest?: typeof boundedIngest; jobMs?: number } = {},
): Promise<{ status: "completed" | "already_claimed"; summary?: SourceUpkeepSummary }> {
  if (!db.claimSourceUpkeep || !db.finishSourceUpkeep) throw new Error("Unsupported upkeep adapter");
  const now = options.now ?? Date.now;
  const claim = await db.claimSourceUpkeep(now());
  if (!claim) return { status: "already_claimed" };
  const deadline = now() + (options.jobMs ?? SOURCE_UPKEEP_JOB_MS);
  const summary: SourceUpkeepSummary = { attempted: 0, added: 0, failed: 0, skipped: 0 };
  const assertLive = () => { if (now() >= deadline) throw new Error("Upkeep deadline exceeded"); };
  const eligible = async (id: string, feedUrl?: string) => {
    assertLive();
    const source = await db.getSource(id);
    assertLive();
    if (!source || source.active === false || source.verified === false || !source.rssUrl?.trim() ||
        (feedUrl !== undefined && source.rssUrl.trim() !== feedUrl)) return null;
    return source;
  };
  for (const id of claim.sourceIds) {
    if (now() >= deadline) { summary.skipped++; continue; }
    try {
      const source = await eligible(id);
      if (!source) { summary.skipped++; continue; }
      summary.attempted++;
      // A timed-out fetch may still finish DNS work, but every subsequent store/write checks
      // the deadline and live source eligibility; it cannot resume writing in the background.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = Math.max(1, deadline - now());
      const work = refreshSourceFeed({
        getItems: (sourceId) => db.getItems(sourceId),
        setCached: async (sourceId, text) => {
          if (!await eligible(sourceId, source.rssUrl!.trim())) throw new Error("Source no longer eligible");
          await db.setCached(sourceId, text);
        },
        addItems: async (items) => {
          if (!await eligible(id, source.rssUrl!.trim())) throw new Error("Source no longer eligible");
          await db.addItems(items);
        },
      }, source, options.ingest ?? boundedIngest, async (items) => {
        if (!await eligible(id, source.rssUrl!.trim())) throw new Error("Source no longer eligible");
        return storeSourceItems(items, { requireEncrypted: true, localOnly: true });
      });
      try {
        const result = await Promise.race([work, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Upkeep deadline exceeded")), remaining);
        })]);
        if (result.error) summary.failed++;
        else summary.added += result.added;
      } finally { clearTimeout(timer); }
    } catch { summary.failed++; }
  }
  await db.finishSourceUpkeep(claim, summary, now());
  return { status: "completed", summary };
}

export async function handleSourceUpkeep(
  request: Request, token: string | undefined, getDatabase: () => Promise<UpkeepDb>,
): Promise<Response> {
  const respond = (body: object, status = 200) => Response.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (!sourceUpkeepAuthorized(request, token)) return respond({ error: "Unauthorized" }, 401);
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  // The caller can supply neither a URL, source selection, nor job parameters.
  if (new URL(request.url).search || !await emptyRequestBody(request)) return respond({ error: "Unexpected input" }, 400);
  try {
    return respond(await runSourceUpkeep(await getDatabase()));
  } catch {
    return respond({ error: "Source upkeep unavailable" }, 503);
  }
}
