import { maxUint256 } from "viem";
import { withdrawPolicySchema } from "./withdraw-protocol";
import { withdrawalRelayRuntime } from "./withdrawal-relay-runtime";
import type { createWithdrawalHttpService } from "./withdrawal-http-service";

type Chain = { networkId: string; rpcUrl: string; cctpDomain: number;
  gatewayWallet: string; gatewayMinter: string; usdcAddress: string };
function integer(value: string | undefined, positive: boolean) {
  if (!value || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > maxUint256
    || positive && BigInt(value) === BigInt(0)) throw new Error();
  return value;
}
/** Server-only explicit opt-in and integer caps. This validates configuration, not
 * journal liquidity or end-to-end operational readiness. No network or file writes. */
export function withdrawalHttpConfiguration(env: Readonly<Record<string, string | undefined>>, chain: Chain):
  Parameters<typeof createWithdrawalHttpService>[0] | null {
  const selected = { ...env };
  if (selected.KERYX_WITHDRAWAL_HTTP_ENABLED === undefined || selected.KERYX_WITHDRAWAL_HTTP_ENABLED === "0") return null;
  try {
    if (selected.KERYX_WITHDRAWAL_HTTP_ENABLED !== "1" || chain.networkId !== "eip155:5042002"
      || chain.cctpDomain !== 26 || selected.KERYX_FORCE_OFFLINE === "1") throw new Error();
    if (!withdrawalRelayRuntime(selected, chain.networkId)) throw new Error();
    const url = new URL(chain.rpcUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    const limits = withdrawPolicySchema.omit({ owner: true, recipient: true }).parse({
      domain: chain.cctpDomain, gatewayWallet: chain.gatewayWallet, gatewayMinter: chain.gatewayMinter, asset: chain.usdcAddress,
      maxValueMicros: integer(selected.KERYX_WITHDRAWAL_MAX_VALUE_MICROS, true),
      maxFeeMicros: integer(selected.KERYX_WITHDRAWAL_MAX_FEE_MICROS, false),
    });
    return { env: selected, network: chain.networkId, rpcUrl: chain.rpcUrl, limits,
      ceilingWei: integer(selected.KERYX_WITHDRAWAL_GAS_CEILING_WEI, true) };
  } catch { throw new Error("Withdrawal HTTP configuration unavailable; verify explicit testnet limits and isolated relay"); }
}
