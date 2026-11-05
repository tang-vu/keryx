import { readResearchAvailabilityForDisplay } from "@/lib/research/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(readResearchAvailabilityForDisplay(), { headers: { "Cache-Control": "no-store" } });
}
