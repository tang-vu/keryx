/**
 * GET /api/activity — the most recent REAL settled citations (source, question, reward, time).
 *
 * Public, no auth. Feeds the live landing ticker and lets external agents/tools see what Keryx
 * is actively citing + paying for right now. Only settled citation payments are returned — the
 * events where a creator wallet actually got paid — so it's a live proof-of-life, not vanity.
 */

import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 15;

export async function GET() {
  try {
    const db = await getDb();
    // Pull a generous recent slice, then keep only settled citations (the creator-paying events).
    const recent = await db.listPayments(80);
    const citations = recent
      .filter((p) => p.kind === "citation" && p.settled)
      .slice(0, LIMIT);

    // Attach the question each citation was for — dedupe queryIds so it's one lookup per query.
    const queryIds = [...new Set(citations.map((p) => p.queryId).filter(Boolean))];
    const questionById = new Map<string, string>();
    await Promise.all(
      queryIds.map(async (qid) => {
        const run = await db.getQueryRun(qid);
        if (run?.question) questionById.set(qid, run.question);
      }),
    );

    const activity = citations.map((p) => ({
      sourceId: p.sourceId,
      sourceName: p.sourceName,
      itemId: p.itemId ?? null,
      itemTitle: p.itemTitle ?? null,
      itemUrl: p.itemUrl ?? null,
      contentVersion: p.contentVersion ?? null,
      itemPublishedAt: p.itemPublishedAt ?? null,
      question: questionById.get(p.queryId) ?? null,
      rewardUsdc: p.amountUsdc,
      origin: p.origin ?? "engine",
      createdAt: p.createdAt,
    }));

    return Response.json(
      { activity },
      { headers: { "cache-control": "public, max-age=15, s-maxage=15" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Degrade gracefully: the ticker treats an empty list as "render nothing", never an error.
    return Response.json({ error: msg, activity: [] }, { status: 200 });
  }
}
