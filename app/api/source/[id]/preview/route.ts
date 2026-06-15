/**
 * Free preview for discovery — titles + summaries only (no payment).
 * GET /api/source/[id]/preview
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";

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
  return Response.json({
    id: source.id,
    name: source.name,
    description: source.description,
    fetchPrice: source.fetchPrice,
    tags: source.tags,
    preview: items.slice(0, 5).map((i) => ({ title: i.title, summary: i.summary })),
  });
}
