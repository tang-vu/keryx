import { http, type Transport } from "viem";
import { chainForProfile } from "./chains";
import { paymentRuntimeConfig } from "./payment-runtime-config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "./arc-network-profile";
const runtimeProfile = paymentRuntimeConfig().profile;
function checkedProfile(profile: ArcNetworkProfile): ArcNetworkProfile {
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) throw new Error("Untrusted Arc RPC profile");
  return profile;
}

/**
 * Check the configured endpoint on every RPC operation. A chain label on a viem
 * client only controls serialization; it does not attest the remote endpoint.
 * Keeping the check in the transport also covers viem's internal reads before
 * a write (nonce, fees, simulation) and catches an endpoint that changes chain
 * after an earlier successful request.
 */
export function attestedArcTransport(base: Transport, verifyAfterResponse = false, trustedProfile: ArcNetworkProfile = runtimeProfile): Transport {
  const profile = checkedProfile(trustedProfile);
  return (parameters) => {
    const transport = base(parameters);
    return {
      ...transport,
      request: (async (args, options) => {
        if (args.method !== "eth_chainId") {
          const observed = await transport.request({ method: "eth_chainId" });
          assertArcChainId(observed, profile);
        }
        const result = await transport.request(args, options);
        if (args.method === "eth_chainId") assertArcChainId(result, profile);
        if (verifyAfterResponse && args.method !== "eth_chainId") {
          assertArcChainId(await transport.request({ method: "eth_chainId" }), profile);
        }
        return result;
      }) as typeof transport.request,
    };
  };
}

export function attestedArcHttp(url: string, options?: Parameters<typeof http>[1], profile: ArcNetworkProfile = runtimeProfile): Transport {
  return attestedArcTransport(http(url, options), false, profile);
}

/** Registry authority reads must be attested after receiving data as well. */
export function attestedArcAuthorityHttp(url: string, options?: Parameters<typeof http>[1], profile: ArcNetworkProfile = runtimeProfile): Transport {
  return attestedArcTransport(http(url, options), true, profile);
}

/** For SDK calls that own their transport and may sign or submit internally. */
export async function assertArcRpcChain(url: string, trustedProfile: ArcNetworkProfile = runtimeProfile): Promise<void> {
  const profile = checkedProfile(trustedProfile);
  // Signing slots can expire in 30 seconds. Bound a stalled provider to one
  // short attempt so a chain preflight cannot consume the authorization window.
  const transport = http(url, { timeout: 4_000, retryCount: 0 })({ chain: chainForProfile(profile) });
  assertArcChainId(await transport.request({ method: "eth_chainId" }), profile);
}

function assertArcChainId(observed: unknown, profile: ArcNetworkProfile): void {
  if (typeof observed !== "string" || !/^0x[0-9a-f]+$/i.test(observed)
    || BigInt(observed) !== BigInt(profile.chainId)) {
    throw new Error(`Configured Arc RPC chain ID does not match ${profile.testnet ? "Arc testnet" : "Arc mainnet"}`);
  }
}
