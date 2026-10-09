import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { deliverableIdSchema, requireDeliverableAcceptance } from "@/lib/deliverable-acceptance/contracts";
import { acceptanceJson } from "@/lib/deliverable-acceptance/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Consent-only state; no reason, owner, original digest, question or payment reference. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (new URL(req.url).search) return acceptanceJson({ error: "invalid_acceptance_request" }, 400);
    const id = deliverableIdSchema.parse((await ctx.params).id);
    return acceptanceJson(await requireDeliverableAcceptance(await getDb()).publicState(config.networkId, id));
  } catch { return acceptanceJson({ error: "acceptance_unavailable" }, 503); }
}
