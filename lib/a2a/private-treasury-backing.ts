import { z } from "zod";
import { config } from "../config";
import type { KeryxDB } from "../db/keryx-db";
import type { PrivateTreasuryPolicy } from "../db/private-treasury-capacity";
import { addressSchema, BUYER_NETWORK } from "../buyer/protocol";
import { getGatewayAvailableAtomic } from "../gateway/gateway-balance";

/** Read-only observation, not a funds reservation or permission to accept payment.
 * Re-read accounting after the balance request to reject observed concurrent changes. */
export async function inspectPrivateTreasuryBacking(db: Pick<KeryxDB, "getPrivateTreasurySummary">,
  policyValue: PrivateTreasuryPolicy, signal?: AbortSignal) {
  const unavailable = (status: "cancelled" | "accounting-unavailable" | "policy-mismatch" | "accounting-changed" | "balance-unavailable") =>
    ({ status, checkoutReady: false as const });
  if (signal?.aborted) return unavailable("cancelled");
  let policy;
  try {
    policy = z.object({ signer: addressSchema, capacityMicros: z.string().regex(/^[1-9]\d{0,11}$/) }).strict().parse(policyValue);
    policy.signer = policy.signer.toLowerCase();
    if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26) return unavailable("policy-mismatch");
  } catch { return unavailable("policy-mismatch"); }
  try {
    const before = await db.getPrivateTreasurySummary(policy.signer);
    if (signal?.aborted) return unavailable("cancelled");
    if (before && before.capacityMicros !== policy.capacityMicros) return unavailable("policy-mismatch");
    const snapshot = JSON.stringify(before);
    const required = BigInt(before?.conservativeBackingMicros ?? policy.capacityMicros);
    const unallocated = before?.unallocatedMicros ?? policy.capacityMicros;
    let available;
    try { available = await getGatewayAvailableAtomic(policy.signer); }
    catch { return unavailable("balance-unavailable"); }
    if (signal?.aborted) return unavailable("cancelled");
    if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26) return unavailable("policy-mismatch");
    if (available === null || available < BigInt(0)) return unavailable("balance-unavailable");
    const after = await db.getPrivateTreasurySummary(policy.signer);
    if (signal?.aborted) return unavailable("cancelled");
    if (config.networkId !== BUYER_NETWORK || config.cctpDomain !== 26) return unavailable("policy-mismatch");
    if (JSON.stringify(after) !== snapshot) return unavailable("accounting-changed");
    return { status: available >= required ? "backed" as const : "insufficient" as const,
      availableMicros: available.toString(), requiredBackingMicros: required.toString(), unallocatedMicros: unallocated,
      poolExists: before !== null, observation: "gateway-and-database" as const,
      checkoutReady: false as const, chainFinalityVerified: false as const };
  } catch { return unavailable("accounting-unavailable"); }
}
