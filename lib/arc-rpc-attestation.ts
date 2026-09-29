import { http, type Transport } from "viem";
import { arcTestnet } from "./chains";

/**
 * Check the configured endpoint on every RPC operation. A chain label on a viem
 * client only controls serialization; it does not attest the remote endpoint.
 * Keeping the check in the transport also covers viem's internal reads before
 * a write (nonce, fees, simulation) and catches an endpoint that changes chain
 * after an earlier successful request.
 */
export function attestedArcTransport(base: Transport, verifyAfterResponse = false): Transport {
  return (parameters) => {
    const transport = base(parameters);
    return {
      ...transport,
      request: (async (args, options) => {
        if (args.method !== "eth_chainId") {
          const observed = await transport.request({ method: "eth_chainId" });
          assertArcChainId(observed);
        }
        const result = await transport.request(args, options);
        if (verifyAfterResponse && args.method !== "eth_chainId") {
          assertArcChainId(await transport.request({ method: "eth_chainId" }));
        }
        return result;
      }) as typeof transport.request,
    };
  };
}

export function attestedArcHttp(url: string, options?: Parameters<typeof http>[1]): Transport {
  return attestedArcTransport(http(url, options));
}

/** Registry authority reads must be attested after receiving data as well. */
export function attestedArcAuthorityHttp(url: string, options?: Parameters<typeof http>[1]): Transport {
  return attestedArcTransport(http(url, options), true);
}

/** For SDK calls that own their transport and may sign or submit internally. */
export async function assertArcRpcChain(url: string): Promise<void> {
  // Signing slots can expire in 30 seconds. Bound a stalled provider to one
  // short attempt so a chain preflight cannot consume the authorization window.
  const transport = http(url, { timeout: 4_000, retryCount: 0 })({ chain: arcTestnet });
  assertArcChainId(await transport.request({ method: "eth_chainId" }));
}

function assertArcChainId(observed: unknown): void {
  if (typeof observed !== "string" || !/^0x[0-9a-f]+$/i.test(observed)
    || BigInt(observed) !== BigInt(arcTestnet.id)) {
    throw new Error("Configured Arc RPC chain ID does not match Arc testnet");
  }
}
