/**
 * POST /api/session/revoke
 *
 * Drops the server-side grant so no further sign-requests are honored.
 * The browser separately issues a Gateway withdraw to return residual USDC
 * to the user's wallet — that on-chain step is independent of this call.
 *
 * Any in-flight agent run will detect the missing grant on its next pre-spend
 * guard and abort cooperatively (emitting a step + ending the SSE stream).
 *
 * SIWE session required. Only the grant owner can revoke.
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { dropGrant, getGrant } from "@/lib/payments/session-grants";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const sessionId = session.address.toLowerCase();
  const grant = getGrant(sessionId);

  // Idempotent: if there's no grant, return success — already revoked.
  if (!grant) {
    return Response.json({ ok: true, alreadyRevoked: true });
  }

  // Safety: confirm the authenticated address owns the grant.
  if (grant.ownerAddr.toLowerCase() !== sessionId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  dropGrant(sessionId);

  // Suppress unused-param lint — req is required by Next.js route handler signature.
  void req;

  return Response.json({
    ok: true,
    sessAddr: grant.sessAddr,
    spent: grant.spent,
    // Browser should withdraw (grant.cap - grant.spent) USDC from the Gateway
    // back to the user's wallet. We echo the amounts for convenience.
    residualUsdc: Math.max(0, grant.cap - grant.spent),
  });
}
