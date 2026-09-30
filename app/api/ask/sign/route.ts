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
 * Persists verified non-bearer metadata before acknowledgement. Only a live,
 * current captured grant can deliver the header to its in-process gateway.
 *
 * Auth: signature recovery is pinned to the durable session/request challenge. No SIWE cookie
 * required here so the endpoint stays non-blocking during the SSE stream
 * (grant creation and ask dispatch bind SIWE; recovery may outlive grant replacement).
 */

import { NextRequest } from "next/server";
import { getGrant } from "@/lib/payments/session-grants";
import { resolveSignature } from "@/lib/payments/pending-signatures";
import { verifyBrowserSignature } from "@/lib/payments/verify-browser-signature";
import { getDb } from "@/lib/db";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

interface SignBody {
  sessionId?: string;
  reqId?: string;
  paymentHeader?: string;
}

export async function POST(req: NextRequest) {
  let body: SignBody;
  try {
    body = (await req.json()) as SignBody;
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

  const db = await getDb();
  let journal;
  try {
    journal = await db.getBrowserJournal(sessionId, reqId);
  } catch {
    return Response.json(
      { error: "authorization recovery unavailable" },
      { status: 503 }
    );
  }
  if (!journal)
    return Response.json(
      { error: "authorization request not found" },
      { status: 404 }
    );
  if (
    ![
      "exposed",
      "signed",
      "submission_attempted",
      "settled",
      "failed",
    ].includes(journal.phase)
  ) {
    return Response.json(
      { error: "authorization was not exposed" },
      { status: 409 }
    );
  }
  let auth;
  try {
    auth = await verifyBrowserSignature(paymentHeader, {
      requirements: journal.requirements,
      expectedSigner: journal.signer,
      expectedNonce: journal.nonce,
    });
  } catch {
    // Keep the live slot available for a valid callback. Never echo a bearer header.
    return Response.json(
      { error: "invalid payment authorization" },
      { status: 400 }
    );
  }
  try {
    if (
      !(await db.signBrowserJournal(sessionId, reqId, {
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        headerHash: createHash("sha256").update(paymentHeader).digest("hex"),
      }))
    ) {
      return Response.json(
        { error: "authorization callback conflicts with durable state" },
        { status: 409 }
      );
    }
  } catch {
    return Response.json(
      { error: "authorization acknowledgement unavailable" },
      { status: 503 }
    );
  }
  // Durable acknowledgement can succeed after timeout/restart/replacement. Only the original
  // live in-process gateway may submit, and only while its captured grant remains current.
  let delivered = false;
  try {
    const grant = await getGrant(sessionId);
    if (
      grant?.grantEpoch === journal.grantEpoch &&
      grant.sessAddr.toLowerCase() === journal.signer.toLowerCase()
    ) {
      delivered = resolveSignature(sessionId, reqId, paymentHeader);
    }
  } catch {
    /* already acknowledged durably; no submission authority */
  }
  return Response.json({ ok: true, delivered });
}
