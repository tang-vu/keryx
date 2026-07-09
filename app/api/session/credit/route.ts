/**
 * GET /api/session/credit?address=0x…
 *
 * Server-side proxy for Circle's Gateway balance API — the browser is blocked by CORS.
 * Returns { available: string } in atomic USDC units (6 decimals).
 *
 * Non-fatal: returns { available: "0" } on any upstream error so the browser's grant
 * poll loop keeps retrying rather than crashing the flow.
 */

import { NextRequest } from "next/server";
import { getGatewayAvailableAtomic } from "@/lib/gateway/gateway-balance";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !address.startsWith("0x")) {
    return Response.json({ available: "0" }, { status: 400 });
  }

  const available = await getGatewayAvailableAtomic(address);
  return Response.json({ available: (available ?? BigInt(0)).toString() });
}
