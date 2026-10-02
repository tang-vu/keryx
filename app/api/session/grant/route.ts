/**
 * POST /api/session/grant
 *
 * Mainnet: the browser retains encrypted session custody and the owner funds Gateway
 * with depositFor(session), without session native gas. A single-use server proposal
 * binds exact network/origin/epoch/cumulative cap/expiry. POST consumes the owner's
 * consent signature and the session signer's separate possession proof atomically.
 * Only known Circle capacity may back the proposal; no native-balance fallback.
 * GET returns the active public consent/proofs and retained cumulative spend.
 *
 * Testnet preserves its legacy tab signer, direct funding/deposit and bounded
 * fresh-grant native-balance fallback. Neither path sends private keys or the secret
 * custody derivation signature to the server. Revocation/expiry cannot erase exposed
 * payment history or withdraw funds from Gateway.
 *
 * SIWE session required. Only the authenticated wallet can create a grant.
 */

import { NextRequest } from "next/server";
import { BrowserGrantRecoveryRefused } from "@/lib/db/browser-authorization-journal";
import { createPublicClient, isAddress, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { getSession } from "@/lib/auth";
import { storeGrant, grantExpiry } from "@/lib/payments/session-grants";
import { getGatewayAvailableAtomic } from "@/lib/gateway/gateway-balance";
import { config } from "@/lib/config";
import { attestedArcHttp } from "@/lib/arc-rpc-attestation";
import { getDb } from "@/lib/db";
import { recordActivationEvent } from "@/lib/activation";
import { accountSessionContext } from "@/lib/account-sessions";
import { consumeMainnetSessionGrant, mainnetGrantPolicy, requireMainnetGrantOrigin } from "@/lib/payments/mainnet-session-grants";
import { readBoundedJson } from "@/lib/read-bounded-json";

export const runtime = "nodejs";

/** Read current owner authority only. No renewal, housekeeping or capacity writes. */
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (req.nextUrl.search) return Response.json({ error: "No grant selector is accepted" }, { status: 400, headers });
  try {
    const ttlMs = config.sessionGrantTtlSeconds * 1000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error();
    const context = await accountSessionContext();
    if (context instanceof Response) return context;
    const row = await context.db.getSessionGrant(context.wallet), now = Date.now();
    if (!row || row.sessionId !== context.wallet || row.ownerAddr.toLowerCase() !== context.wallet ||
      !Number.isSafeInteger(row.expiry) || row.expiry <= now)
      return Response.json({ active: false }, { headers });
    if (config.profile.name === "arc") {
      const proof = await context.db.getSessionGrantConsent(context.wallet, row.grantEpoch), policy = mainnetGrantPolicy();
      if (!proof || proof.consent.sessAddr !== row.sessAddr.toLowerCase() || proof.consent.origin !== policy.origin ||
        Number(proof.consent.capMicroUsdc) !== Math.round(row.cap * 1e6) || Number(proof.consent.expirySeconds) * 1000 !== row.expiry)
        throw new Error("Owner consent unavailable");
      return Response.json({ active: true, sessionId: row.sessionId, ownerAddr: row.ownerAddr, sessAddr: row.sessAddr,
        grantEpoch: row.grantEpoch, network: config.profile.networkId, origin: policy.origin,
        capMicroUsdc: proof.consent.capMicroUsdc, consent: proof.consent, ownerSignature: proof.ownerSignature, sessionSignature: proof.sessionSignature,
        spentMicroUsdc: String(Math.round(row.spent * 1e6)),
        expiresAt: new Date(row.expiry).toISOString(), serverNow: new Date(now).toISOString(),
        remainingMs: row.expiry - now, ttlMs }, { headers });
    }
    return Response.json({ active: true, sessionId: row.sessionId, ownerAddr: row.ownerAddr, sessAddr: row.sessAddr,
      grantEpoch: row.grantEpoch, expiresAt: new Date(row.expiry).toISOString(), serverNow: new Date(now).toISOString(),
      remainingMs: row.expiry - now, ttlMs }, { headers });
  } catch { return Response.json({ error: "Session status unavailable" }, { status: 503, headers }); }
}

interface GrantBody {
  sessAddr?: string;
  budget?: number;
  txHash?: string;
  /** Recovery mode: re-register a grant for an already-funded session EOA
   *  (e.g. on a new device). Funds live in the Gateway, not the EOA, so the
   *  EOA-balance check and the funding txHash are skipped. */
  recover?: boolean;
}

export async function POST(req: NextRequest) {
  // Require SIWE auth — only authenticated askers can create session grants.
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (config.profile.name === "arc") {
    const headers = { "Cache-Control": "no-store" };
    try { requireMainnetGrantOrigin(req); } catch { return Response.json({ error: "Grant deployment or origin refused" }, { status: 403, headers }); }
    let input;
    try { input = await readBoundedJson(new Response(req.body), 8192); }
    catch { return Response.json({ error: "Invalid owner consent body" }, { status: 400, headers }); }
    try {
      const db = await getDb(), consent = await consumeMainnetSessionGrant(db, session.address, input), now = Date.now();
      const current = await db.getSessionGrant(consent.ownerAddr);
      if (!current || current.grantEpoch !== consent.grantEpoch) throw new Error("Grant replaced before acknowledgement");
      return Response.json({ ok: true, sessionId: consent.ownerAddr, sessAddr: consent.sessAddr,
        ownerAddr: consent.ownerAddr, grantEpoch: consent.grantEpoch, cap: Number(consent.capMicroUsdc) / 1e6,
        spentMicroUsdc: String(Math.round(current.spent * 1e6)),
        expiresAt: new Date(Number(consent.expirySeconds) * 1000).toISOString(), serverNow: new Date(now).toISOString(),
        remainingMs: Number(consent.expirySeconds) * 1000 - now, ttlMs: config.sessionGrantTtlSeconds * 1000 }, { headers });
    } catch { return Response.json({ error: "Owner consent is invalid, expired, unavailable or already consumed" }, { status: 409, headers }); }
  }

  let body: GrantBody;
  try {
    body = await req.json() as GrantBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { sessAddr, budget, txHash, recover } = body;

  // Validate required fields.
  if (!sessAddr || !isAddress(sessAddr)) {
    return Response.json({ error: "sessAddr must be a valid hex address" }, { status: 400 });
  }
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0 || budget > 10) {
    return Response.json({ error: "budget must be a positive number ≤ 10 USDC" }, { status: 400 });
  }
  // A funding txHash is required for a fresh grant, but not for recovery (no new tx).
  if (!recover && (!txHash || typeof txHash !== "string")) {
    return Response.json({ error: "txHash is required" }, { status: 400 });
  }

  // The Gateway balance is what settlement actually draws on, so it — not the client's
  // claim — decides the cap. A definite answer is authoritative in both directions:
  // zero means the deposit never landed, and anything less than the claim clamps it.
  const availableAtomic = await getGatewayAvailableAtomic(sessAddr);
  let cap = budget;

  if (availableAtomic !== null) {
    const availableUsdc = Number(availableAtomic) / 1e6;
    if (availableUsdc <= 0) {
      return Response.json(
        {
          error:
            "Circle's Gateway holds no USDC for this session address — the deposit may still be confirming.",
          sessAddr,
        },
        { status: 402 },
      );
    }
    let verifiedCumulativeCapacity = availableUsdc;
    try {
      const db = await getDb();
      if (await db.browserJournalActive()) {
        // Budget is cumulative. Only independently evidenced confirmed debits may restore
        // the consumed portion of that ceiling; pending and unknown holds never get credit.
        verifiedCumulativeCapacity += (await db.browserSignerConfirmedSpendMicro(sessAddr)) / 1e6;
      }
    } catch {
      return Response.json({ error: "Session recovery accounting is unavailable." }, { status: 503 });
    }
    if (verifiedCumulativeCapacity < budget) {
      console.warn(
        `[grant] clamping cap for ${sessAddr}: claimed ${budget} > available ${availableUsdc}`,
      );
      cap = verifiedCumulativeCapacity;
    }
  } else if (!recover) {
    // Circle is unreachable. Fall back to proving the EOA was funded at all: on Arc,
    // USDC is the native gas token, so a native balance read needs no ERC-20 call.
    // Skipped when recovering — those funds sit in the Gateway, so the EOA is legitimately
    // near-empty and this check would reject every valid recovery.
    try {
      const publicClient = createPublicClient({
        chain: arcTestnet,
        transport: attestedArcHttp(config.rpcUrl),
      });
      const native = await publicClient.getBalance({ address: sessAddr as `0x${string}` });
      // 10% of the claimed cap: a truly unfunded EOA holds zero, and we don't want to
      // penalise one that already spent gas on its approve + deposit.
      if (native < parseUnits((budget * 0.1).toFixed(18), 18)) {
        return Response.json(
          {
            error:
              "Session EOA appears unfunded — fund the address with USDC on Arc before creating a grant.",
            sessAddr,
          },
          { status: 402 },
        );
      }
    } catch (err) {
      // Do not create payment authority from a caller claim when neither independent funding
      // source is reachable. Circle remains the economic ceiling, but a fail-open grant also buys
      // server-side compute and weakens the visible hard-cap story.
      console.warn(
        "[grant] funding check unavailable:",
        err instanceof Error ? err.message : String(err),
      );
      return Response.json(
        { error: "Session funding could not be verified. Try again when Arc RPC is available." },
        { status: 503 },
      );
    }
  } else {
    return Response.json(
      { error: "Circle Gateway balance is unavailable; session recovery is temporarily paused." },
      { status: 503 },
    );
  }

  // One active grant per SIWE address — use the address as the sessionId so
  // the browser can re-derive it without a separate session-id cookie.
  // The SIWE address is already the authenticated identity; this mapping is
  // stable within the JWT's 7-day lifetime.
  const sessionId = session.address.toLowerCase();

  const expiry = grantExpiry();
  const ttlMs = config.sessionGrantTtlSeconds * 1000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(expiry) || expiry <= Date.now())
    return Response.json({ error: "Session expiry configuration unavailable" }, { status: 503 });
  let grantEpoch: string;
  try { grantEpoch = await storeGrant(sessionId, {
    sessAddr,
    ownerAddr: session.address,
    cap,
    expiry,
    txHash: txHash ?? "recovered", // no new funding tx in recovery mode
  }); } catch (error) {
    return error instanceof BrowserGrantRecoveryRefused
      ? Response.json({ error: "Session recovery cannot reset retained authorization capacity. Keep the original signer and cumulative cap; unresolved authorizations remain reserved." }, { status: 409 })
      : Response.json({ error: "Session recovery accounting is unavailable. Try again when durable storage is available." }, { status: 503 });
  }

  if (!recover) {
    try {
      await recordActivationEvent(await getDb(), "reader_session_funded");
    } catch {
      // Funding/grant success is authoritative; telemetry is best-effort only.
    }
  }

  const now = Date.now();
  return Response.json({
    ok: true,
    sessionId,
    sessAddr,
    ownerAddr: session.address.toLowerCase(),
    grantEpoch,
    cap,
    // Echo expiry so the browser can show the remaining TTL.
    expiresAt: new Date(expiry).toISOString(),
    serverNow: new Date(now).toISOString(), remainingMs: Math.max(0, expiry - now),
    ttlMs,
  }, { headers: { "Cache-Control": "no-store" } });
}
