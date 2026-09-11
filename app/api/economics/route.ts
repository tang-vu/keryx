/** Retired public operational snapshot. Internal cost/margin telemetry stays private. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ error: "Operational economics are private.", calculator: "/economics" }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
