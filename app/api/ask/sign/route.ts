/**
 * POST /api/ask/sign
 *
 * Called by the browser after it has built and signed the EIP-712
 * payment authorization for a specific sign-request.
 *
 * Body: { sessionId, reqId, paymentHeader }
 *   - sessionId: the SIWE-derived session id (= lowercased wallet address)
 *   - reqId: the UUID echoed from the SSE sign-request event
 *   - paymentHeader: base64-encoded {signature, authorization} — the value
 *     that goes straight into the "payment-signature" HTTP header
 *
 * On success, resolves the pending-signature promise held by session-grants.ts
 * so the BrowserCoSignGateway can retry the source immediately.
 *
 * Auth: the sessionId is validated against the active grant. No SIWE cookie
 * required here so the endpoint stays non-blocking during the SSE stream
 * (the cookie jar is httpOnly and already validated at grant-creation time).
 */

import { NextRequest } from "next/server";
import { resolveSignature, getGrant } from "@/lib/payments/session-grants";

export const runtime = "nodejs";

interface SignBody {
  sessionId?: string;
  reqId?: string;
  paymentHeader?: string;
}

export async function POST(req: NextRequest) {
  let body: SignBody;
  try {
    body = await req.json() as SignBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { sessionId, reqId, paymentHeader } = body;

  if (!sessionId || typeof sessionId !== "string") {
    return Response.json({ error: "sessionId required" }, { status: 400 });
  }
  if (!reqId || typeof reqId !== "string") {
    return Response.json({ error: "reqId required" }, { status: 400 });
  }
  if (!paymentHeader || typeof paymentHeader !== "string") {
    return Response.json({ error: "paymentHeader required" }, { status: 400 });
  }

  // Verify the sessionId maps to an active grant so a rogue caller can't resolve
  // arbitrary pending promises by guessing reqIds.
  const grant = getGrant(sessionId);
  if (!grant) {
    return Response.json({ error: "no active grant for sessionId" }, { status: 404 });
  }

  // Resolve scoped to this sessionId — prevents cross-session promise resolution.
  const resolved = resolveSignature(sessionId, reqId, paymentHeader);
  if (!resolved) {
    // reqId not found — either already resolved, timed out, or bad id.
    return Response.json({ error: "reqId not found or already resolved" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
