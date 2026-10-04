import { z } from "zod";
import { setPublicSourceClaimPolicy } from "@/lib/sources/public-source-claim-service";
import { sourceClaimModeSchema } from "@/lib/sources/public-source-claim";
import { claimIdSchema, revisionSchema, claimWriteContext, claimBody, claimResponse, claimError } from "../../shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { db, wallet } = await claimWriteContext(req), { id } = await ctx.params;
    const body = await claimBody(req, z.object({ mode: sourceClaimModeSchema, expectedRevision: revisionSchema,
      distributionPermission: z.boolean().default(false) }).strict());
    return claimResponse({ claim: await setPublicSourceClaimPolicy(db, { ...body, wallet, claimId: claimIdSchema.parse(id) }) });
  } catch (error) { return claimError(error); }
}
