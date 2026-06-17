/**
 * POST /api/session/grant
 *
 * Called by the browser after the user has:
 *   1. Generated a session EOA (key lives in the tab only).
 *   2. Sent one MetaMask tx to fund that EOA with USDC + native gas.
 *   3. Called gateway.deposit() from the browser to credit Circle's Gateway.
 *
 * This endpoint records the grant server-side so BrowserCoSignGateway can
 * enforce the cap. It stores ONLY { sessAddr, ownerAddr, cap, expiry, txHash }
 * — never a private key (there is none server-side for user sessions).
 *
 * SIWE session required. Only the authenticated wallet can create a grant.
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { storeGrant, grantExpiry } from "@/lib/payments/session-grants";

export const runtime = "nodejs";

interface GrantBody {
  sessAddr?: string;
  budget?: number;
  txHash?: string;
}

export async function POST(req: NextRequest) {
  // Require SIWE auth — only authenticated askers can create session grants.
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: GrantBody;
  try {
    body = await req.json() as GrantBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { sessAddr, budget, txHash } = body;

  // Validate required fields.
  if (!sessAddr || !sessAddr.startsWith("0x") || sessAddr.length < 40) {
    return Response.json({ error: "sessAddr must be a valid hex address" }, { status: 400 });
  }
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0 || budget > 10) {
    return Response.json({ error: "budget must be a positive number ≤ 10 USDC" }, { status: 400 });
  }
  if (!txHash || typeof txHash !== "string") {
    return Response.json({ error: "txHash is required" }, { status: 400 });
  }

  // One active grant per SIWE address — use the address as the sessionId so
  // the browser can re-derive it without a separate session-id cookie.
  // The SIWE address is already the authenticated identity; this mapping is
  // stable within the JWT's 7-day lifetime.
  const sessionId = session.address.toLowerCase();

  storeGrant(sessionId, {
    sessAddr,
    ownerAddr: session.address,
    cap: budget,
    expiry: grantExpiry(),
    txHash,
  });

  return Response.json({
    ok: true,
    sessionId,
    sessAddr,
    cap: budget,
    // Echo expiry so the browser can show the remaining TTL.
    expiresAt: new Date(grantExpiry()).toISOString(),
  });
}
