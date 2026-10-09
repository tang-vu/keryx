import { z } from "zod";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { RegistrationSponsorError } from "@/lib/db/registration-sponsor";
import { SourceClaimError } from "@/lib/db/public-source-claims";
import { claimBody } from "../../source-claims/shared";
import { prepareSponsoredRegistration, recoverSponsoredRegistration, submitSponsoredRegistration } from "@/lib/sources/registration-sponsor-service";
import { registrationSponsorReadChain, registrationSponsorRuntime } from "@/lib/sources/registration-sponsor-runtime";
import { registrationPolicyDigest } from "@/lib/sources/registration-sponsor-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const idSchema = z.string().regex(/^0x[0-9a-f]{64}$/).transform(value => value as `0x${string}`);
const bodySchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("prepare"), claimId: z.string().regex(/^[a-f0-9]{64}$/), fetchPrice: z.number().finite().min(0).max(1_000_000), replacesRequestId: idSchema.optional() }).strict(),
  z.object({ operation: z.literal("submit"), id: idSchema, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform(value => value as `0x${string}`) }).strict(),
]);
const headers = { "Cache-Control": "no-store", Vary: "Cookie, Origin", "Referrer-Policy": "no-referrer" };
const response = (value: unknown, status = 200) => Response.json(value, { status, headers });
function failure(error: unknown) {
  if (error instanceof RegistrationSponsorError || error instanceof SourceClaimError)
    return response({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) return response({ error: "Invalid sponsored registration request", code: "invalid_request" }, 400);
  return response({ error: "Sponsorship is unavailable. Retain the original request and inspect its status before another action.", code: "sponsor_unavailable" }, 503);
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url), session = await getSession();
    const requestId = url.searchParams.get("id"), claimId = url.searchParams.get("claimId");
    if (requestId || claimId) {
      if (!session) return response({ error: "Sign in with the original creator wallet" }, 401);
      const db = await getDb();
      const claim = claimId ? await db.getSourceClaim?.(z.string().regex(/^[a-f0-9]{64}$/).parse(claimId)) : null;
      if (claimId && (!claim || claim.ownerWallet !== session.address.toLowerCase())) return response({ error: "Original registration not found" }, 404);
      const row = await db.getRegistrationSponsor?.({ wallet: session.address,
        ...(requestId ? { id: idSchema.parse(requestId) } : { canonicalUrl: claim!.canonicalUrl }) });
      if (!row) return response({ error: "Original registration not found" }, 404);
      try { return response({ original: await recoverSponsoredRegistration(db, session.address, row.id, registrationSponsorReadChain(row)) }); }
      catch { return response({ original: row, recoveryUnavailable: true }); }
    }
    const ctx = await registrationSponsorRuntime();
    if (!ctx || !session || !ctx.policy.allowlistedCreators.includes(session.address.toLowerCase() as `0x${string}`))
      return response({ available: false });
    await ctx.chain.assertRegistry();
    return response({ available: true, network: ctx.policy.network, registryAddress: ctx.policy.registryAddress,
      sponsorAddress: ctx.policy.sponsorAddress, policyDigest: registrationPolicyDigest(ctx.policy),
      maxGasWei: ctx.policy.maxTransactionWei, requiresPublishingProof: true });
  } catch { return response({ available: false }); }
}
export async function POST(req: Request) {
  try {
    const origin = new URL(config.baseUrl).origin;
    // Next may expose its internal listener in req.url behind a reverse proxy.
    // Browser Origin is pinned here; ingress Host/proxy validation belongs to the public wrapper.
    if (req.headers.get("origin") !== origin)
      return response({ error: "Use this deployment's creator registration page", code: "origin_mismatch" }, 403);
    const session = await getSession();
    if (!session) return response({ error: "Sign in with the source owner wallet" }, 401);
    const body = await claimBody(req, bodySchema), ctx = await registrationSponsorRuntime();
    if (!ctx) return response({ error: "Registration gas sponsorship is not enabled", code: "sponsor_disabled" }, 503);
    const original = body.operation === "prepare"
      ? await prepareSponsoredRegistration(ctx, session.address, body)
      : await submitSponsoredRegistration(ctx, session.address, body.id, body.signature);
    return response({ original }, body.operation === "submit" ? 202 : 200);
  } catch (error) { return failure(error); }
}
