import { getTestnetArchive } from "@/lib/history/testnet-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const archive = await getTestnetArchive();
    if (!archive) return Response.json({ error: "Testnet creator history unavailable" }, { status: 503, headers });
    return Response.json({ archive: archive.info, creators: await archive.creatorLeaderboard() }, { headers });
  } catch {
    return Response.json({ error: "Testnet creator history unavailable" }, { status: 503, headers });
  }
}
