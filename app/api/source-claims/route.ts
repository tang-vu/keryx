import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { SourceClaimError } from "@/lib/db/public-source-claims";
import { sourceClaimForUrl, assertSourceClaimScope } from "@/lib/sources/public-source-claim-service";
import { sourceClaimProof, sourceClaimProofUrl } from "@/lib/sources/public-source-claim";
import { sourceClaimProofToken } from "@/lib/sources/public-source-claim-proof";
import { claimIdSchema, claimResponse, claimError } from "./shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const url = new URL(req.url), db = await getDb();
    if (!db.getSourceClaim) throw new SourceClaimError("Source claims are unavailable on this backend", 503, "claims_unavailable");
    const challengeId = url.searchParams.get("challengeId");
    if (challengeId) {
      const session = await getSession(), challenge = await db.getSourceClaimChallenge?.(claimIdSchema.parse(challengeId));
      if (!session) throw new SourceClaimError("Sign in to resume this challenge", 401);
      if (!challenge || challenge.wallet !== session.address.toLowerCase()) throw new SourceClaimError("Challenge unavailable", 404);
      assertSourceClaimScope(challenge);
      if (challenge.consumedAt || Date.now() >= Date.parse(challenge.expiresAt)) throw new SourceClaimError("Challenge expired or already used", 409, "challenge_expired");
      return claimResponse({ challenge, proof: sourceClaimProof(challenge), proofToken: sourceClaimProofToken(challenge),
        proofUrl: sourceClaimProofUrl(challenge.canonicalUrl, challenge.rssUrl, challenge.proofMethod), claim: await db.getSourceClaim(challenge.claimId) });
    }
    const id = url.searchParams.get("claimId"), canonicalUrl = url.searchParams.get("canonicalUrl");
    if (id || canonicalUrl) {
      const claim = id ? await db.getSourceClaim(claimIdSchema.parse(id)) : await sourceClaimForUrl(db, canonicalUrl!);
      if (claim) assertSourceClaimScope(claim);
      return claimResponse({ claim, controlMaxAgeMs: 24 * 3600_000, network: config.networkId });
    }
    const session = await getSession();
    if (!session) throw new SourceClaimError("Sign in to inspect your source claims", 401);
    const claims = await db.listSourceClaims?.(session.address) ?? [];
    return claimResponse({ claims: claims.filter(claim => claim.network === config.networkId && claim.deploymentOrigin === new URL(config.baseUrl).origin) });
  } catch (error) { return claimError(error); }
}
