import type { NextRequest } from "next/server";
import { searchPaperLibrary } from "@/lib/papers/search";
import { admitPaperSearch, parsePaperRequest } from "@/lib/papers/request";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Public bibliography is separate from /api/sources and its payment payee allowlist. */
export async function GET(request: NextRequest) {
  let query;
  try { query = parsePaperRequest(request.nextUrl.searchParams); }
  catch { return Response.json({ error: "Invalid paper query or filters" }, { status: 400, headers }); }
  if (query.live) {
    const caller = clientIp(request);
    const retryAfter = admitPaperSearch(caller);
    if (retryAfter) return Response.json({ error: "Paper search is temporarily busy", retryAfter },
      { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
  }
  return Response.json(await searchPaperLibrary(query.filters, { live: query.live, signal: request.signal }), { headers });
}
