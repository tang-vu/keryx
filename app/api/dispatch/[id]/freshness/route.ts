/**
 * GET /api/dispatch/[id]/freshness — public, metadata-only citation drift audit.
 *
 * The response compares immutable article ids/hashes/CIDs and feed publication dates. It never
 * decrypts paid text, initiates a payment, or claims that a changed version alters correctness.
 */

import { getDb } from "@/lib/db";
import { loadFreshness } from "@/lib/answers-freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  try {
    const db = await getDb();
    const run = await db.getQueryRun(id);
    if (!run) return Response.json({ error: "not found" }, { status: 404 });

    const checkedAt = new Date().toISOString();
    const freshness = await loadFreshness(db, run, Date.parse(checkedAt));
    return Response.json(
      {
        queryId: run.id,
        settledAt: run.createdAt,
        checkedAt,
        freshness,
        interpretation: {
          current:
            "The exact paid content version still matches Keryx's current indexed article asset.",
          superseded:
            "The same article id now resolves to another immutable version; the replacement was not read by this dispatch.",
          unavailable:
            "Keryx could not load a current indexed asset, so no freshness conclusion is possible.",
        },
        limits: [
          "Version drift is not a correctness verdict.",
          "This endpoint reads metadata only and does not buy or decrypt replacement content.",
          "The archived answer, evidence, and payment receipt remain immutable.",
        ],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "freshness unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
