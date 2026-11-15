import { z } from "zod";
import type { NextRequest } from "next/server";
import { canonicalJson } from "@/lib/canonical-json";
import { getDb } from "@/lib/db";
import { applicationStorageIdentity, assertApplicationStorageCurrentLocal } from "@/lib/db/application-storage";
import { config } from "@/lib/config";
import { ARC_MAINNET_PROFILE } from "@/lib/arc-network-profile";
import { configuredHostedTreasuryPolicy } from "@/lib/payments/hosted-treasury-policy";
import { mainnetHostedPolicy } from "@/lib/payments/mainnet-hosted-gateway";
import { configuredOperatingFeePolicy, operatingFeePolicyDigest, operatingFeeMaxMicroUsdc, operatingFeeEndpointPath, OPERATING_FEE_SOURCE_ID } from "@/lib/payments/operating-fee-policy";
import { settleThenServe } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({ query: z.string().uuid(), amount: z.string().regex(/^[1-9][0-9]{0,15}$/),
  policy: z.string().regex(/^[0-9a-f]{64}$/), allocation: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

/** A service receipt, not a public-content sale. Seller admission requires its exact retained hosted original. */
export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid operating fee request" }, { status: 400 });
  const params = parsed.data;
  try {
    const profile = config.profile, baseUrl = config.baseUrl;
    const db = await getDb(), hosted = await mainnetHostedPolicy(db), identity = await applicationStorageIdentity(db, "write");
    const hostedWire = canonicalJson(hosted), identityWire = canonicalJson(identity);
    // Awaited provenance establishes the genuine facade. This final synchronous
    // check only narrows that authority, after every last await and before HTTP.
    const currentPolicy = () => {
      assertApplicationStorageCurrentLocal(db, "write");
      if (profile !== ARC_MAINNET_PROFILE || config.profile !== profile || config.baseUrl !== baseUrl
        || new URL(baseUrl).origin !== hosted.origin || process.env.KERYX_FORCE_OFFLINE === "1"
        || canonicalJson(configuredHostedTreasuryPolicy(identity, hosted.origin, "public")) !== hostedWire)
        throw new Error("Operating fee authority changed");
      return configuredOperatingFeePolicy(identity, hosted.origin, hosted.signer);
    };
    const policy = currentPolicy();
    if (params.policy !== operatingFeePolicyDigest(policy) || BigInt(params.amount) > BigInt(operatingFeeMaxMicroUsdc(hosted.queryCapMicroUsdc)))
      return Response.json({ error: "Operating fee terms changed or amount exceeds limit" }, { status: 409 });
    const endpoint = operatingFeeEndpointPath(params.query, { amountMicroUsdc: params.amount, policyDigest: params.policy, allocationDigest: params.allocation });
    return settleThenServe(request, { priceUsdc: Number(params.amount) / 1e6, payTo: policy.beneficiary,
      endpoint, resourceSourceId: OPERATING_FEE_SOURCE_ID, resourceKind: "operating-fee", singleSettlementAttempt: true,
      description: "Keryx-sponsored operating fee for unclaimed public citations",
      beforeSettlementAsync: async () => {
        try {
          const currentHosted = await mainnetHostedPolicy(db);
          const currentIdentity = await applicationStorageIdentity(db, "write");
          if (canonicalJson(currentHosted) !== hostedWire || canonicalJson(currentIdentity) !== identityWire)
            return Response.json({ error: "Operating fee authority changed" }, { status: 409 });
          return canonicalJson(currentPolicy()) === canonicalJson(policy) ? null
            : Response.json({ error: "Operating fee authority changed" }, { status: 409 });
        } catch { return Response.json({ error: "Operating fee authority unavailable" }, { status: 503 }); }
      },
      beforeSettlement: () => {
        try {
          const current = currentPolicy();
          return canonicalJson(current) === canonicalJson(policy) ? null : Response.json({ error: "Operating fee authority changed" }, { status: 409 });
        } catch { return Response.json({ error: "Operating fee authority unavailable" }, { status: 503 }); }
      },
    }, () => ({ ok: true, kind: "operating-fee", sponsoredBy: "Keryx", allocationDigest: params.allocation }));
  } catch { return Response.json({ error: "Operating fee authority unavailable" }, { status: 503 }); }
}
