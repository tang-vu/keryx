/**
 * Reads how much USDC Circle's Gateway holds for a depositor address.
 *
 * The browser cannot call the Gateway API directly (CORS), so `/api/session/credit`
 * proxies this for the grant flow's poll loop, and `/api/session/grant` uses it to
 * check a claimed cap against the deposit that actually landed.
 *
 * Returns atomic 6-decimal units. `null` means the API could not be reached or
 * answered — distinguishable from a definite zero, which callers treat differently:
 * an unfunded address is a rejection, an unreachable Circle is not.
 */

import { parseUnits } from "viem";
import { config } from "../config";

// Verified from @circle-fin/x402-batching/dist/client/index.js:638-672.
const GATEWAY_BALANCE_API = "https://gateway-api-testnet.circle.com/v1/balances";

export async function getGatewayAvailableAtomic(address: string): Promise<bigint | null> {
  try {
    const upstream = await fetch(GATEWAY_BALANCE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ depositor: address, domain: config.cctpDomain }],
      }),
    });
    if (!upstream.ok) return null;

    const data = (await upstream.json()) as { balances?: Array<{ balance?: string }> };
    // Circle returns a human-decimal string ("0.05"), the same value its SDK feeds to
    // parseUnits(balance, 6). Convert to atomic units — BigInt() would throw on the decimal.
    return parseUnits(data.balances?.[0]?.balance ?? "0", 6);
  } catch {
    return null;
  }
}
