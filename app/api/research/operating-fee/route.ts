import { z } from "zod";
import type { NextRequest } from "next/server";
import { canonicalJson } from "@/lib/canonical-json";
import { getDb } from "@/lib/db";
import { applicationSqliteIdentity } from "@/lib/db/application-storage";
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
    const db = await getDb(), hosted = mainnetHostedPolicy(db), identity = applicationSqliteIdentity(db, "write");
    const policy = configuredOperatingFeePolicy(identity, hosted.origin, hosted.signer);
    if (params.policy !== operatingFeePolicyDigest(policy) || BigInt(params.amount) > BigInt(operatingFeeMaxMicroUsdc(hosted.queryCapMicroUsdc)))
      return Response.json({ error: "Operating fee terms changed or amount exceeds limit" }, { status: 409 });
    const endpoint = operatingFeeEndpointPath(params.query, { amountMicroUsdc: params.amount, policyDigest: params.policy, allocationDigest: params.allocation });
    return settleThenServe(request, { priceUsdc: Number(params.amount) / 1e6, payTo: policy.beneficiary,
      endpoint, resourceSourceId: OPERATING_FEE_SOURCE_ID, resourceKind: "operating-fee", singleSettlementAttempt: true,
      description: "Keryx-sponsored operating fee for unclaimed public citations",
      beforeSettlement: () => {
        try {
          const current = configuredOperatingFeePolicy(identity, hosted.origin, hosted.signer);
          return canonicalJson(current) === canonicalJson(policy) ? null : Response.json({ error: "Operating fee authority changed" }, { status: 409 });
        } catch { return Response.json({ error: "Operating fee authority unavailable" }, { status: 503 }); }
      },
    }, () => ({ ok: true, kind: "operating-fee", sponsoredBy: "Keryx", allocationDigest: params.allocation }));
  } catch { return Response.json({ error: "Operating fee authority unavailable" }, { status: 503 }); }
}
