/**
 * GET /api/session/credit?address=0x…
 *
 * Server-side proxy for Circle's Gateway balance API — the browser is blocked by CORS.
 * Returns { available: string } in atomic USDC units (6 decimals).
 *
 * Unknown balances return HTTP 503 with available: null. Never turn an upstream
 * outage into evidence that the wallet needs more funding.
 */

import { NextRequest } from "next/server";
import { getGatewayAvailableAtomic } from "@/lib/gateway/gateway-balance";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ available: null, status: "invalid_address" }, { status: 400, headers });
  }

  const available = await getGatewayAvailableAtomic(address);
  const identity = { address: address.toLowerCase(), network: config.networkId };
  return available === null
    ? Response.json({ ...identity, available: null, status: "unavailable" }, { status: 503, headers })
    : Response.json({ ...identity, available: available.toString(), status: "known" }, { headers });
}
