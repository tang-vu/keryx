/**
 * Free preview for discovery — titles + summaries only (no payment).
 * GET /api/source/[id]/preview
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { normalizePreviewDepth, previewSummary } from "@/lib/sources/preview-depth";
import {
  sourceItemAssetId,
  sourceItemIdentity,
} from "@/lib/sources/source-item-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return Response.json({ error: "source not found" }, { status: 404 });
  const items = await db.getItems(id);
  // The creator's preview-depth choice decides how much of each item this free surface reveals.
  const depth = normalizePreviewDepth(source.previewDepth);
  return Response.json({
    id: source.id,
    name: source.name,
    description: source.description,
    fetchPrice: source.fetchPrice,
    tags: source.tags,
    previewDepth: depth,
    preview: items.slice(0, 5).map((i) => {
      const summary = previewSummary(i.summary, depth);
      const identity = sourceItemIdentity(i);
      const metadata = {
        assetId: sourceItemAssetId(i.id),
        ...identity,
        // Compatibility alias for clients that already render preview[].title.
        title: i.title,
        paidPath: `/api/source/${source.id}/item/${encodeURIComponent(i.id)}?version=${encodeURIComponent(identity.contentVersion)}`,
      };
      // "locked" yields an empty summary — omit the field so the shape reads as title-only.
      return summary ? { ...metadata, summary } : metadata;
    }),
  });
}
