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
 * Best-effort on-chain check: reads the session EOA's native balance (Arc USDC ==
 * native token) before storing the grant. Rejects when the balance is verifiably
 * zero (unfunded EOA). If the RPC call fails, the grant is allowed (fail-open so
 * RPC hiccups don't hard-block legit users) but the failure is logged.
 *
 * SIWE session required. Only the authenticated wallet can create a grant.
 */

import { NextRequest } from "next/server";
import { createPublicClient, http, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { getSession } from "@/lib/auth";
import { storeGrant, grantExpiry } from "@/lib/payments/session-grants";
import { config } from "@/lib/config";

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

  // Best-effort on-chain balance check — reject grant for verifiably unfunded EOAs.
  // On Arc, USDC == native gas token (same balance, two views). We read native balance
  // (18-decimal) which is always available without an ERC-20 call.
  // Threshold: the claimed budget converted to 18-decimal (native) with 10% slack to
  // tolerate gas costs already spent during approve/deposit steps.
  try {
    const publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(config.rpcUrl),
    });
    const native = await publicClient.getBalance({ address: sessAddr as `0x${string}` });
    // Minimum: 10% of the claimed cap to allow for gas already consumed. A truly
    // unfunded EOA has 0 balance; we don't penalise partially-spent ones.
    const minNative = parseUnits((budget * 0.1).toFixed(18), 18);
    if (native < minNative) {
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
    // RPC hiccup — fail open so a flaky RPC node doesn't hard-block users.
    console.warn(
      "[grant] on-chain balance check failed (fail-open):",
      err instanceof Error ? err.message : String(err),
    );
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
