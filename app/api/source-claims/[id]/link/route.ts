import { z } from "zod";
import { linkPublicSourceClaim } from "@/lib/sources/public-source-claim-service";
import { claimIdSchema, revisionSchema, claimWriteContext, claimBody, claimResponse, claimError } from "../../shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { db, wallet } = await claimWriteContext(req), { id } = await ctx.params;
    const body = await claimBody(req, z.object({ sourceId: z.string().min(1).max(256), expectedRevision: revisionSchema }).strict());
    return claimResponse({ claim: await linkPublicSourceClaim(db, { ...body, wallet, claimId: claimIdSchema.parse(id) }) });
  } catch (error) { return claimError(error); }
}
