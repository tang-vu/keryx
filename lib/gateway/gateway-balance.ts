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

/** How many depositors to ask about per request — the API takes a list; this keeps each modest. */
const BATCH = 25;

/**
 * Gateway holdings for many addresses at once, in whole USDC, keyed by LOWERCASED address.
 *
 * Used by the settlement-parity watchdog to check what Keryx tells creators against what Circle
 * actually holds for them. Two rules carry the honesty of that check:
 *
 *  - An address the API did not answer for maps to `null`, never to 0. A silent Circle must read
 *    as "unknown", or an outage would look exactly like a creator's money vanishing.
 *  - `pendingBatch` counts toward the balance. Funds mid-settlement have left the payer and are
 *    owed to the payee; excluding them would invent a shortfall for every busy wallet.
 *
 * A failed chunk marks only its own addresses unknown, so one bad request cannot blank the sweep.
 */
export async function getGatewayHeldUsdc(addresses: string[]): Promise<Map<string, number | null>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map<string, number | null>(unique.map((a) => [a, null]));

  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    try {
      const upstream = await fetch(GATEWAY_BALANCE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "USDC",
          sources: chunk.map((depositor) => ({ depositor, domain: config.cctpDomain })),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!upstream.ok) continue; // chunk stays unknown

      const data = (await upstream.json()) as {
        balances?: Array<{ depositor?: string; balance?: string; pendingBatch?: string }>;
      };
      for (const b of data.balances ?? []) {
        const key = b.depositor?.toLowerCase();
        // Key off the echoed depositor rather than array position: an answer that dropped or
        // reordered an entry would otherwise attach one creator's balance to another's claim.
        if (!key || !out.has(key)) continue;
        out.set(key, Number(b.balance ?? 0) + Number(b.pendingBatch ?? 0));
      }
    } catch {
      /* timeout or transport error — the chunk's addresses stay unknown */
    }
  }
  return out;
}
