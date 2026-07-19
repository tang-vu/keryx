/**
 * GET /api/creator/[id]/export?format=csv|json&limit=N — a creator's full payout ledger
 * as a downloadable file. Public, like the rest of /api/creator/[id]: every payout is
 * already visible on the public creator page and on-chain, so the export exposes nothing
 * new — it just makes the same record portable.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  buildEarningsRows,
  exportFilename,
  summariseEarnings,
  toCsv,
} from "@/lib/creator/earnings-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 5_000;
const MAX_LIMIT = 50_000;
/** Question text costs one row read per distinct dispatch. Beyond this the export still
 *  ships — with empty question cells — rather than hammering the DB on a huge history. */
const MAX_QUESTION_LOOKUPS = 1_000;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
  const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (!source) {
      return NextResponse.json({ error: "creator not found" }, { status: 404 });
    }

    const payments = (await db.listPaymentsBySource(id)).slice(0, limit);

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

    const baseUrl = req.nextUrl.origin;
    const rows = buildEarningsRows(payments, questionById, baseUrl);
    const filename = exportFilename(id, format);
    const headers = {
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Earnings move with every dispatch; a cached ledger would look like lost income.
      "Cache-Control": "no-store",
    };

    if (format === "json") {
      return NextResponse.json(
        {
          creator: {
            id: source.id,
            name: source.name,
            walletAddress: source.walletAddress,
          },
          summary: summariseEarnings(payments),
          exportedAt: new Date().toISOString(),
          truncated: rows.length === limit,
          payments: rows,
        },
        { headers },
      );
    }

    return new NextResponse(toCsv(rows), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}
