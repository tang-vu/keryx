import { getTestnetArchive } from "@/lib/history/testnet-archive";
import { historyBefore, historyNext, questionSummary } from "@/lib/history/public-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let before;
  try { before = historyBefore(new URL(request.url).searchParams); }
  catch { return Response.json({ error: "Invalid history page" }, { status: 400 }); }
  try {
    const archive = await getTestnetArchive();
    if (!archive) return Response.json({ error: "Testnet history unavailable" }, { status: 503 });
    const runs = await archive.listRecentQueries(51, before);
    return Response.json({ archive: archive.info, summary: await archive.summary(),
      runs: runs.slice(0, 50).map(run => questionSummary(run, archive.info)),
      next: runs.length > 50 ? historyNext(runs[49]) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Testnet history unavailable" }, { status: 503 }); }
}
