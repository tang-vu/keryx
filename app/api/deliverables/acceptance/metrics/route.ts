import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { requireDeliverableAcceptance } from "@/lib/deliverable-acceptance/contracts";
import { acceptanceJson } from "@/lib/deliverable-acceptance/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (new URL(req.url).search) return acceptanceJson({ error: "invalid_acceptance_request" }, 400);
  try { return acceptanceJson(await requireDeliverableAcceptance(await getDb()).metrics(config.networkId)); }
  catch { return acceptanceJson({ error: "acceptance_unavailable" }, 503); }
}
