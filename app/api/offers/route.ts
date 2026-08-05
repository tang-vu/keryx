import { NextRequest } from "next/server";

import { getDb } from "@/lib/db";
import { listArticleMarket } from "@/lib/offers/offer-book";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requested = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requested) ? requested : 50;
  const query = req.nextUrl.searchParams.get("q") ?? "";
  const offers = await listArticleMarket(await getDb(), { query, limit });
  return Response.json({ offers, count: offers.length });
}
