/**
 * Free-preview depth for a single source — owner-only.
 *
 *   GET  /api/creator/[id]/preview-depth  → { depth } for the owner (used by the profile panel to
 *                                            self-gate: non-owners get 401/403 and render nothing)
 *   POST /api/creator/[id]/preview-depth  → set the depth; body { depth: "full"|"excerpt"|"locked" }
 *
 * Depth is public config (it already rides on the /preview response), but only the source's payout
 * wallet or an author wallet may change it. This lets an already-registered creator tune the
 * incentive dial after the fact from their own profile — see lib/sources/preview-depth.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { normalizePreviewDepth, PREVIEW_DEPTHS } from "@/lib/sources/preview-depth";
import type { Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True when `addr` is the source's payout wallet or one of its author wallets. */
function ownsSource(source: Source, addr: string): boolean {
  const a = addr.toLowerCase();
  return (
    source.walletAddress.toLowerCase() === a ||
    source.authors.some((au) => au.walletAddress.toLowerCase() === a)
  );
}

async function loadOwned(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return { error: NextResponse.json({ error: "source not found" }, { status: 404 }) };
  if (!ownsSource(source, session.address)) {
    return { error: NextResponse.json({ error: "not your source" }, { status: 403 }) };
  }
  return { db, source };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;
  return NextResponse.json({ depth: normalizePreviewDepth(owned.source.previewDepth) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!PREVIEW_DEPTHS.includes(body.depth as never)) {
    return NextResponse.json(
      { error: `depth must be one of ${PREVIEW_DEPTHS.join(", ")}` },
      { status: 400 },
    );
  }
  const depth = normalizePreviewDepth(body.depth);
  await owned.db.setSourcePreviewDepth(id, depth);
  return NextResponse.json({ depth });
}
