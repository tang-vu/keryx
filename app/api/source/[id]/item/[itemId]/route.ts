/** x402-protected immutable article asset. Registry source owns price and payout authority. */
import { NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { sourceFetchPayTo } from "@/lib/registry/source-fetch-payto";
import {
  sourceItemCacheKey,
  sourceItemIdentity,
} from "@/lib/sources/source-item-asset";
import { resolveSourceItemContent } from "@/lib/sources/resolve-source-item-content";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await ctx.params;
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return Response.json({ error: "source not found" }, { status: 404 });

  const item = await db.getItem(id, itemId);
  if (!item) return Response.json({ error: "article not found" }, { status: 404 });

  const identity = sourceItemIdentity(item);
  const requestedVersion = req.nextUrl.searchParams.get("version");
  if (!requestedVersion || requestedVersion !== identity.contentVersion) {
    return Response.json(
      { error: "article version changed; rediscover before paying" },
      { status: 409 },
    );
  }
  const payTo = await sourceFetchPayTo(source);
  const cacheKey = sourceItemCacheKey(id, item);

  return settleThenServe(
    req,
    {
      priceUsdc: source.fetchPrice,
      payTo,
      endpoint: `/api/source/${id}/item/${encodeURIComponent(itemId)}?version=${encodeURIComponent(identity.contentVersion)}`,
      description: `${source.name} — ${item.title}`,
    },
    async (settle) => {
      const cached = await db.getCached(cacheKey);
      const content =
        cached ??
        (await resolveSourceItemContent(item, settle, { allowSummaryFallback: false }));
      if (!cached) await db.setCached(cacheKey, content);

      return { content, name: source.name, item: identity };
    },
  );
}
