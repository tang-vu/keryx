/**
 * GET /api/session/credit?address=0x…
 *
 * Server-side proxy for Circle's Gateway balance API.
 * The browser cannot call gateway-api-testnet.circle.com directly — CORS blocks it.
 * This route forwards the request from the server, where there is no CORS restriction,
 * and returns { available: string } in atomic USDC units (6 decimals).
 *
 * Non-fatal: returns { available: "0" } on any upstream error so the browser poll
 * loop continues rather than crashing the grant flow.
 */

import { NextRequest } from "next/server";
import { parseUnits } from "viem";
import { config } from "@/lib/config";

export const runtime = "nodejs";

// Circle's balance API accepts a POST with a JSON body specifying token + sources.
// Verified from @circle-fin/x402-batching/dist/client/index.js:638-672.
const GATEWAY_BALANCE_API = "https://gateway-api-testnet.circle.com/v1/balances";
// Arc testnet CCTP domain = 26 (from lib/config.ts and CLAUDE.md).
const ARC_CCTP_DOMAIN = config.cctpDomain;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !address.startsWith("0x")) {
    return Response.json({ available: "0" }, { status: 400 });
  }

  try {
    const upstream = await fetch(GATEWAY_BALANCE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ depositor: address, domain: ARC_CCTP_DOMAIN }],
      }),
    });

    if (!upstream.ok) {
      // Upstream error — non-fatal, return zero so the poll retries.
      return Response.json({ available: "0" });
    }

    const data = await upstream.json() as {
      balances?: Array<{ balance?: string }>;
    };
    // Circle returns `balance` as a human-decimal USDC string (e.g. "0.05") — the same
    // value its SDK feeds to parseUnits(balance, 6). Convert to atomic 6-decimal units so
    // this route honors its documented contract (atomic string). The sole caller parses
    // the result with BigInt(), which THROWS on a decimal string like "0.05"; that throw
    // was being swallowed and left funded sessions stuck "confirming" forever.
    const decimal = data.balances?.[0]?.balance ?? "0";
    const available = parseUnits(decimal, 6).toString();
    return Response.json({ available });
  } catch {
    // Network error — non-fatal.
    return Response.json({ available: "0" });
  }
}
