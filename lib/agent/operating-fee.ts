import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { allocateSplit } from "../payments/split-allocation";
import { operatingFeeContextSchema, operatingFeePolicyDigest, type OperatingFeeContext, type OperatingFeePolicy } from "../payments/operating-fee-policy";
import { canonicalSourceUrl } from "../sources/public-source-claim";
import type { Citation, OperatingFeeSnapshot } from "../types";

/** Preserve exact retained article associations across catalog/web IDs, without host inference. */
export function retainExactItemClaimUrls(map: Map<string, string[]>, itemUrl: string, claimUrls: readonly string[]) {
  try {
    const exactUrl = canonicalSourceUrl(itemUrl);
    map.set(exactUrl, [...new Set([...(map.get(exactUrl) ?? []), ...claimUrls])]);
  } catch { /* An invalid article URL cannot authorize an operating fee. */ }
}

/** Allocate only an unclaimed public citation's original share. Claimed/unknown shares stay unspent. */
export async function prepareOperatingFee(input: {
  queryId: string; poolUsdc: number; citations: Citation[]; policy: OperatingFeePolicy;
  readClaim: (url: string) => Promise<unknown>;
  itemClaimUrls?: ReadonlyMap<string, readonly string[]>;
}): Promise<{ snapshot: OperatingFeeSnapshot; context: OperatingFeeContext } | null> {
  const amounts = allocateSplit(input.poolUsdc, input.citations.map(citation => citation.weight));
  const allocations: OperatingFeeSnapshot["allocations"] = [];
  const sourceUrls = new Set<string>();
  for (const [index, citation] of input.citations.entries()) {
    if (citation.sourceKind !== "public-reference" || citation.evidenceProvenance === "synthetic-demo" || !citation.itemUrl || !(amounts[index] > 0)) continue;
    try {
      const itemUrl = canonicalSourceUrl(citation.itemUrl);
      if (await input.readClaim(itemUrl)) continue;
      const claimUrls = (input.itemClaimUrls?.get(itemUrl) ?? []).map(canonicalSourceUrl);
      let claimed = false;
      for (const claimUrl of claimUrls) if (await input.readClaim(claimUrl)) { claimed = true; break; }
      if (claimed) continue;
      allocations.push({ marker: citation.marker, sourceId: citation.sourceId, itemUrl, amountUsdc: amounts[index] });
      sourceUrls.add(itemUrl);
      for (const claimUrl of claimUrls) sourceUrls.add(claimUrl);
    } catch { /* Unknown ownership never grants a fee; other qualified citations remain usable. */ }
  }
  if (allocations.length === 0) return null;
  const amountMicroUsdc = allocations.reduce((sum, item) => sum + BigInt(Math.round(item.amountUsdc * 1e6)), BigInt(0)).toString();
  const context = operatingFeeContextSchema.parse({ policyDigest: operatingFeePolicyDigest(input.policy),
    allocationDigest: createHash("sha256").update(canonicalJson({ policy: "public-citation-operating-fee-v1", queryId: input.queryId, allocations })).digest("hex"),
    amountMicroUsdc, sourceUrls: [...sourceUrls] });
  return { context, snapshot: { policy: "public-citation-operating-fee-v1", beneficiary: input.policy.beneficiary,
    amountUsdc: Number(amountMicroUsdc) / 1e6, allocations, status: "withheld", reason: "Awaiting sponsored operating settlement." } };
}
