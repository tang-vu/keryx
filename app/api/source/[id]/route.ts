/**
 * x402-protected creator content. Paying the toll (payTo = creator wallet) unlocks the full text.
 * GET /api/source/[id]
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) {
    return Response.json({ error: "source not found" }, { status: 404 });
  }

  return settleThenServe(
    req,
    {
      priceUsdc: source.fetchPrice,
      payTo: source.walletAddress,
      endpoint: `/api/source/${id}`,
      description: `${source.name} — full content`,
    },
    async () => {
      const items = await db.getItems(id);
      const content =
        items.map((i) => `## ${i.title}\n${i.content || i.summary}`).join("\n\n") ||
        source.description;
      return { content, name: source.name, items: items.length };
    },
  );
}
