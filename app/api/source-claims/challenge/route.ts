import { z } from "zod";
import { config } from "@/lib/config";
import { SourceClaimError } from "@/lib/db/public-source-claims";
import { canonicalSourceUrl, sourceClaimProof, sourceClaimProofUrl, sourceClaimProofMethodSchema } from "@/lib/sources/public-source-claim";
import { sourceClaimProofToken } from "@/lib/sources/public-source-claim-proof";
import { claimWriteContext, claimBody, claimResponse, claimError } from "../shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ canonicalUrl: z.string().url().max(2048), rssUrl: z.string().url().max(2048).optional(),
  publicReferenceId: z.string().max(256).startsWith("public:").optional(), proofMethod: sourceClaimProofMethodSchema.optional() }).strict();
export async function POST(req: Request) {
  try {
    const { db, wallet } = await claimWriteContext(req), body = await claimBody(req, bodySchema);
    if (!db.issueSourceClaimChallenge) throw new SourceClaimError("Atomic source claims are unavailable on this backend", 503, "claims_unavailable");
    let canonicalUrl: string, rssUrl: string | undefined;
    try { canonicalUrl = canonicalSourceUrl(body.canonicalUrl); rssUrl = body.rssUrl ? canonicalSourceUrl(body.rssUrl) : undefined; }
    catch { throw new SourceClaimError("Source and feed URLs require credential-free HTTPS", 400, "invalid_source_url"); }
    if (body.publicReferenceId) {
      const reference = await db.getPublicReference?.(body.publicReferenceId);
      if (!reference || canonicalSourceUrl(reference.url) !== canonicalUrl || canonicalSourceUrl(reference.rssUrl) !== rssUrl)
        throw new SourceClaimError("Claim source/feed must match the existing public catalog reference", 409, "reference_mismatch");
    }
    const challenge = await db.issueSourceClaimChallenge({ wallet, canonicalUrl, rssUrl, publicReferenceId: body.publicReferenceId, proofMethod: body.proofMethod,
      deploymentOrigin: new URL(config.baseUrl).origin, network: config.networkId });
    return claimResponse({ challenge, proof: sourceClaimProof(challenge), proofToken: sourceClaimProofToken(challenge),
      proofUrl: sourceClaimProofUrl(canonicalUrl, rssUrl, challenge.proofMethod),
      claim: await db.getSourceClaim?.(challenge.claimId) ?? null });
  } catch (error) { return claimError(error); }
}
