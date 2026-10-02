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
import { ARC_MAINNET_PROFILE } from "@/lib/arc-network-profile";
import { accountSessionContext } from "@/lib/account-sessions";
import { readRetainedMainnetSessionAuthority } from "@/lib/payments/retained-session-authority";
import { mainnetGrantPolicy } from "@/lib/payments/mainnet-session-grants";
import { canonicalJson } from "@/lib/canonical-json";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ available: null, status: "invalid_address" }, { status: 400, headers });
  }

  if (req.nextUrl.searchParams.has("accounting")) {
    if (config.profile !== ARC_MAINNET_PROFILE) return Response.json({ available: null, status: "unavailable" }, { status: 404, headers });
    const owner = await accountSessionContext();
    if (owner instanceof Response) return owner;
    const signer = address.toLowerCase();
    try {
      const query = req.nextUrl.searchParams;
      if (new URL(req.url).origin !== mainnetGrantPolicy().origin || query.get("accounting") !== "original-v1" ||
        [...query.keys()].some(key => !["address", "accounting", "grantEpoch", "after"].includes(key) || query.getAll(key).length !== 1)) throw new Error();
      const after = query.get("after") ?? undefined, suppliedEpoch = query.get("grantEpoch");
      if (after !== undefined && (!Number.isFinite(Date.parse(after)) || new Date(after).toISOString() !== after || Date.parse(after) > Date.now())) throw new Error();
      const before = await owner.db.sessionFundingAccounting(signer, after);
      if (before.hasAuthorityHistory) {
        const active = suppliedEpoch ? null : await owner.db.getSessionGrant(owner.wallet);
        const epoch = z.string().uuid().parse(suppliedEpoch ?? (active?.sessAddr.toLowerCase() === signer ? active.grantEpoch : undefined));
        await readRetainedMainnetSessionAuthority(owner.db, owner.wallet, epoch, signer);
      }
      const available = await getGatewayAvailableAtomic(signer, config.profile);
      const accounting = await owner.db.sessionFundingAccounting(signer, after);
      if (available === null || canonicalJson(accounting) !== canonicalJson(before)) throw new Error();
      return Response.json({ address: signer, network: config.networkId, available: String(available), status: "known",
        accountingAuthority: "original-admitted-settled-v1", observedAt: new Date().toISOString(),
        ...(after ? { debitBaselineObservedAt: after } : {}), ...accounting }, { headers });
    } catch {
      return Response.json({ address: signer, network: config.networkId, available: null, status: "unavailable" }, { status: 503, headers });
    }
  }

  const available = await getGatewayAvailableAtomic(address);
  const identity = { address: address.toLowerCase(), network: config.networkId };
  return available === null
    ? Response.json({ ...identity, available: null, status: "unavailable" }, { status: 503, headers })
    : Response.json({ ...identity, available: available.toString(), status: "known" }, { headers });
}
