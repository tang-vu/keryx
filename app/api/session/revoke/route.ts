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
import { revokeGrant, getGrant } from "@/lib/payments/session-grants";
import { readBoundedRequestJson } from "@/lib/read-bounded-request-json";
import { sessionRevokeRequestSchema } from "@/lib/session-revoke-request";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const session = await getSession();
    if (!session) return Response.json({ error: "unauthenticated" }, { status: 401, headers });
    if (!req.body) return Response.json({ error: "session_upgrade_required", message: "Refresh Keryx and recover your session before revoking." },
      { status: 428, headers });
    let expected;
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) throw new Error();
      expected = sessionRevokeRequestSchema.parse(await readBoundedRequestJson(req, 2048));
    } catch {
      return Response.json({ error: "invalid_session_identity" }, { status: 400, headers });
    }
    const sessionId = session.address.toLowerCase();
    if (expected.sessionId !== sessionId) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const grant = await getGrant(sessionId);
    // A valid captured tuple can acknowledge an already absent live grant.
    if (!grant) return Response.json({ ok: true, alreadyRevoked: true }, { headers });
    if (grant.ownerAddr.toLowerCase() !== sessionId) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (grant.grantEpoch !== expected.grantEpoch || grant.sessAddr.toLowerCase() !== expected.sessAddr ||
        !(await revokeGrant(expected))) {
      return Response.json({ error: "session_changed", message: "Your spending session changed. Review the current session before revoking it." },
        { status: 409, headers });
    }
    return Response.json({
      ok: true, sessAddr: grant.sessAddr, spent: grant.spent,
      // Advisory only: withdrawal still requires independent balance checks.
      residualUsdc: Math.max(0, grant.cap - grant.spent),
    }, { headers });
  } catch {
    // A lost database acknowledgement cannot authorize local custody deletion.
    return Response.json({ error: "revocation_unavailable" }, { status: 503, headers });
  }
}
