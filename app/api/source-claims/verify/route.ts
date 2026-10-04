import { z } from "zod";
import { SourceClaimError } from "@/lib/db/public-source-claims";
import { verifyPublicSourceClaimProof } from "@/lib/sources/public-source-claim-proof";
import { assertSourceClaimScope } from "@/lib/sources/public-source-claim-service";
import { claimIdSchema, claimWriteContext, claimBody, claimResponse, claimError } from "../shared";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  try {
    const { db, wallet } = await claimWriteContext(req), body = await claimBody(req, z.object({ challengeId: claimIdSchema }).strict());
    if (!db.reserveSourceClaimVerification || !db.verifySourceClaim) throw new SourceClaimError("Atomic source verification is unavailable", 503, "claims_unavailable");
    const challenge = await db.reserveSourceClaimVerification(body.challengeId, wallet);
    assertSourceClaimScope(challenge);
    const proofDigest = await verifyPublicSourceClaimProof(challenge);
    const claim = await db.verifySourceClaim({ challengeId: challenge.id, wallet, proofDigest });
    return claimResponse({ claim });
  } catch (error) { return claimError(error); }
}
