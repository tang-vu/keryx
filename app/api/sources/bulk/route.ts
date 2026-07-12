/**
 * POST /api/sources/bulk — batch-import many RSS feeds in one pass.
 *   body: { feeds: string[], fetchPrice?: number }
 *
 * For each feed this runs the SAME core as POST /api/sources (ingest → store meta + items →
 * compute on-chain register params), then returns one result per feed:
 *   { rssUrl, ok, status, mode?, sourceId?, registryAddress?, registerParams?, verification?, error? }
 *
 * The server does NOT submit any register() transaction. When the registry is configured the
 * client fires the txs itself, one signature per ready feed — inherent to a non-custodial,
 * per-source on-chain registry (the contract has no batch register). This endpoint just does the
 * one shared feed-read + dedupe so the creator pastes a list once instead of re-typing each URL.
 *
 * The payout wallet is always the session wallet (spoof-proof); a client-supplied one is ignored.
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { prepareSourceRegistration } from "@/lib/sources/prepare-registration";
import { sanitizeFeedUrls } from "@/lib/ingest/feed-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How many feeds to ingest at once — enough to feel fast, low enough to spare the upstream RSS
// hosts and the RPC the on-chain path reads.
const CONCURRENCY = 5;

interface FeedResult {
  rssUrl: string;
  ok: boolean;
  status: number;
  [k: string]: unknown;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const feeds = sanitizeFeedUrls(body.feeds);
  if (feeds.length === 0) {
    return Response.json(
      { error: "provide a non-empty `feeds` array of http(s) URLs" },
      { status: 400 },
    );
  }

  const db = await getDb();
  const fetchPrice = body.fetchPrice != null ? Number(body.fetchPrice) : undefined;

  const prepareOne = async (rssUrl: string): Promise<FeedResult> => {
    try {
      const { status, payload } = await prepareSourceRegistration(db, session.address, {
        rssUrl,
        ...(fetchPrice != null && Number.isFinite(fetchPrice) ? { fetchPrice } : {}),
      });
      return { rssUrl, ok: status < 400, status, ...payload };
    } catch (err) {
      // A single feed blowing up must never sink the whole batch — record it and move on.
      return {
        rssUrl,
        ok: false,
        status: 500,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  // Bounded-concurrency map preserving input order.
  const results: FeedResult[] = new Array(feeds.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < feeds.length) {
      const i = cursor++;
      results[i] = await prepareOne(feeds[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, feeds.length) }, worker));

  const ready = results.filter((r) => r.ok).length;
  return Response.json({ total: results.length, ready, results });
}
