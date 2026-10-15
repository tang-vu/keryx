import { readResearchVisibility } from "@/lib/run-privacy/ask-publication";
import { privateRunResponse } from "@/lib/run-claims/private-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return privateRunResponse(Response.json(await readResearchVisibility())); }
  catch { return privateRunResponse(Response.json({ error: "visibility_unavailable" }, { status: 503 })); }
}
