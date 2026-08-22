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
 * The cap is never the number the client asked for: it is clamped to the USDC Circle's
 * Gateway actually holds for the session EOA. A client that overstates its deposit gets
 * the real balance as its ceiling instead of a rejection, so an honest client racing its
 * own agent's spend is never dead-ended. For a fresh grant, when Circle cannot be reached
 * we fall back to the session EOA's native balance, which at least proves the address was
 * funded. If neither balance source is available, or if a recovery cannot be verified
 * against Circle, the request fails closed and the client retries later.
 *
 * SIWE session required. Only the authenticated wallet can create a grant.
 */

import { NextRequest } from "next/server";
import { createPublicClient, http, isAddress, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { getSession } from "@/lib/auth";
import { storeGrant, grantExpiry } from "@/lib/payments/session-grants";
import { getGatewayAvailableAtomic } from "@/lib/gateway/gateway-balance";
import { config } from "@/lib/config";

export const runtime = "nodejs";

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
    if (availableUsdc < budget) {
      console.warn(
        `[grant] clamping cap for ${sessAddr}: claimed ${budget} > available ${availableUsdc}`,
      );
      cap = availableUsdc;
    }
  } else if (!recover) {
    // Circle is unreachable. Fall back to proving the EOA was funded at all: on Arc,
    // USDC is the native gas token, so a native balance read needs no ERC-20 call.
    // Skipped when recovering — those funds sit in the Gateway, so the EOA is legitimately
    // near-empty and this check would reject every valid recovery.
    try {
      const publicClient = createPublicClient({
        chain: arcTestnet,
        transport: http(config.rpcUrl),
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

  await storeGrant(sessionId, {
    sessAddr,
    ownerAddr: session.address,
    cap,
    expiry: grantExpiry(),
    txHash: txHash ?? "recovered", // no new funding tx in recovery mode
  });

  return Response.json({
    ok: true,
    sessionId,
    sessAddr,
    cap,
    // Echo expiry so the browser can show the remaining TTL.
    expiresAt: new Date(grantExpiry()).toISOString(),
  });
}
