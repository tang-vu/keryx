import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { isPublicReferenceId } from "@/lib/public-references/catalog";
import { sourceFetchTerms } from "@/lib/registry/source-fetch-payto";
import { sourceItemIdentity } from "@/lib/sources/source-item-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Independent, version-bound item metadata. This endpoint grants no paid content. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await ctx.params;
  if (isPublicReferenceId(id)) return Response.json({ error: "Public references have no payout authority" }, { status: 410 });
  try {
    const db = await getDb();
    const source = await db.getSource(id);
    if (!source) return Response.json({ error: "source not found" }, { status: 404 });
    const item = await db.getItem(id, itemId);
    if (!item) return Response.json({ error: "article not found" }, { status: 404 });
    const identity = sourceItemIdentity(item);
    const versions = req.nextUrl.searchParams.getAll("version");
    if (versions.length !== 1 || versions[0] !== identity.contentVersion)
      return Response.json({ error: "article version changed; rediscover before paying" }, { status: 409 });
    const terms = await sourceFetchTerms(source, { refresh: true });
    if (!terms.active || source.active === false || source.verified === false)
      return Response.json({ error: "source is not active on the earning rail" }, { status: 410 });
    const micros = Math.round(terms.listPriceUsdc * 1_000_000);
    if (!Number.isSafeInteger(micros) || micros < 0 || Math.abs(terms.listPriceUsdc - micros / 1_000_000) > 1e-10)
      throw new Error("Invalid source price");
    return Response.json({ sourceId: id, item: identity, payTo: terms.payTo, listPriceMicroUsdc: String(micros) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "source authority unavailable" }, { status: 503 });
  }
}
