import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { reviewPeriodSchema } from "@/lib/research/decision-review-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const url = new URL(req.url);
    if ([...url.searchParams.keys()].some(key => !["since", "until"].includes(key)) ||
      url.searchParams.getAll("since").length !== 1 || url.searchParams.getAll("until").length !== 1) return Response.json({ error: "invalid_period" }, { status: 400, headers });
    const since = url.searchParams.get("since")!, until = url.searchParams.get("until")!;
    if (!reviewPeriodSchema.safeParse({ network: config.profile.networkId, since, until }).success || Date.parse(until) > Date.now()) return Response.json({ error: "invalid_period" }, { status: 400, headers });
    const store = (await getDb()).decisionReviews;
    if (!store) return Response.json({ error: "review_unavailable" }, { status: 503, headers });
    return Response.json(await store.metrics(config.profile.networkId, since, until), { headers });
  } catch { return Response.json({ error: "review_unavailable" }, { status: 503, headers }); }
}
