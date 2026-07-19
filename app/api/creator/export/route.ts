/**
 * GET /api/creator/export?format=csv|json&limit=N — one wallet's payouts across every source
 * it owns, as a downloadable ledger. The per-source export (`/api/creator/[id]/export`) is
 * public because a single source's payouts are already public; this one is NOT — merging a
 * wallet's whole portfolio into one file reveals which sources belong to the same person, so
 * it is gated on proving control of that wallet.
 *
 * Two ways to prove it, because two kinds of caller need this: a creator clicking a link in
 * their browser (SIWE session cookie) and an accounting script or agent (Authorization:
 * Bearer kx_live_…, the same key the public API already issues per wallet).
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { verifyApiKey } from "@/lib/api-keys";
import { checkRateLimit } from "@/lib/rate-limit";
import { sourcesOwnedBy } from "@/lib/sources/source-ownership";
import {
  hasScope,
  parseScopes,
  parseSourceIds,
  restrictToKeySources,
} from "@/lib/api-key-scopes";
import { summariseEarnings } from "@/lib/creator/earnings-export";
import {
  PORTFOLIO_COLUMNS,
  buildPortfolioRows,
  sortNewestFirst,
  summarisePortfolioBySource,
} from "@/lib/creator/portfolio-export";
import { exportFilename, toCsv } from "@/lib/creator/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 100_000;
/** Question text costs one row read per distinct dispatch. Past this the file still ships,
 *  with empty question cells, rather than hammering the DB on a very long history. */
const MAX_QUESTION_LOOKUPS = 2_000;

export async function GET(req: NextRequest) {
  const auth = await resolveWallet(req);
  if ("error" in auth) return auth.error;
  const { wallet } = auth;

  // Full-table read per call; keyed by wallet so one creator's export loop can't starve others.
  const limited = await checkRateLimit(wallet.toLowerCase(), "public");
  if (limited) return limited;

  const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

  try {
    const db = await getDb();
    // listAllSources, not listSources: a source the creator has since deactivated on-chain
    // still earned real money, and an audit file that silently drops it is wrong.
    // Ownership decides first, the key's pin only ever narrows what is left — so a key can
    // never name a source id into the result that its wallet does not own.
    const owned = restrictToKeySources(
      sourcesOwnedBy(await db.listAllSources(), wallet),
      auth.sourceIds,
    );
    if (owned.length === 0) {
      return NextResponse.json(
        { error: "no sources owned by this wallet", wallet },
        { status: 404 },
      );
    }

    const perSource = await Promise.all(owned.map((s) => db.listPaymentsBySource(s.id)));
    const payments = sortNewestFirst(perSource.flat()).slice(0, limit);

    const uniqueQueryIds = [
      ...new Set(payments.map((p) => p.queryId).filter(Boolean)),
    ].slice(0, MAX_QUESTION_LOOKUPS);
    const questionById = new Map<string, string>();
    await Promise.all(
      uniqueQueryIds.map(async (qid) => {
        const run = await db.getQueryRun(qid);
        if (run?.question) questionById.set(qid, run.question);
      }),
    );

    // Behind the Cloudflare Tunnel the request origin is the internal localhost:3939, which
    // would put dead links in a file the creator keeps. Same canonical base as the sitemap.
    const baseUrl = process.env.BASE_URL || "https://keryx.cc";
    const rows = buildPortfolioRows(payments, questionById, baseUrl);
    const filename = exportFilename(`portfolio-${wallet.slice(0, 10)}`, format);
    const headers = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Earnings move with every dispatch; a cached ledger would look like lost income.
      // Private to this wallet, so no shared cache may keep a copy either.
      "Cache-Control": "no-store, private",
    };

    if (format === "json") {
      return NextResponse.json(
        {
          wallet,
          sources: owned.map((s) => ({
            id: s.id,
            name: s.name,
            walletAddress: s.walletAddress,
            active: s.active !== false,
          })),
          summary: summariseEarnings(payments),
          bySource: summarisePortfolioBySource(payments),
          exportedAt: new Date().toISOString(),
          truncated: rows.length === limit,
          payments: rows,
        },
        { headers },
      );
    }

    return new NextResponse(toCsv(PORTFOLIO_COLUMNS, rows), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** SIWE session cookie, else a wallet-issued API key. A session is unscoped (the owner is
 *  present in person); a key carries whatever scope + source pin it was minted with. */
async function resolveWallet(
  req: NextRequest,
): Promise<{ wallet: string; sourceIds: string[] | null } | { error: NextResponse }> {
  const authHeader = req.headers.get("authorization");
  const rawKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (rawKey) {
    const keyCtx = await verifyApiKey(rawKey);
    if (!keyCtx) {
      return { error: NextResponse.json({ error: "invalid or revoked api key" }, { status: 401 }) };
    }
    if (!hasScope(parseScopes(keyCtx.scopes), "export")) {
      return {
        error: NextResponse.json(
          { error: "this api key is not scoped for export" },
          { status: 403 },
        ),
      };
    }
    const db = await getDb();
    void db.incrementUsage(keyCtx.keyId);
    return { wallet: keyCtx.walletAddress, sourceIds: parseSourceIds(keyCtx.sourceIds) };
  }

  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json(
        { error: "connect your wallet, or send Authorization: Bearer kx_live_…" },
        { status: 401 },
      ),
    };
  }
  return { wallet: session.address, sourceIds: null };
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
