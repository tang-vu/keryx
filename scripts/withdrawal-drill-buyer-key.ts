import type { Hex } from "viem";

/** Original buyer env naming; conflicting loaded keys never choose a signer silently. */
export function withdrawalDrillBuyerKey(env: Readonly<Record<string, string | undefined>>): Hex {
  const current = env.KERYX_BUYER_PRIVATE_KEY, legacy = env.BUYER_PRIVATE_KEY;
  if (current && legacy && current.toLowerCase() !== legacy.toLowerCase())
    throw new Error("Conflicting withdrawal drill buyer keys");
  const key = current || legacy;
  if (!key || !/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Withdrawal drill buyer key unavailable");
  return key as Hex;
}
