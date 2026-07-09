/**
 * x402 citation settlement. Dynamic price = the agent-computed weighted reward.
 * payTo is the specified author wallet (validated to belong to the source).
 * POST /api/cite/[id]?author=<wallet>&amount=<usdc>&query=<id>
 *
 * payTo authority is the on-chain SourceRegistry, not the `sources.authors` column:
 * the column is a file on this host, so a write to it would silently reroute every
 * future reward. Sources with no registry record fall back to the column (documented
 * residual); an unreadable chain falls back too, loudly, rather than halting settlement.
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { settleThenServe } from "@/lib/x402-server";
import { allowedPayTo, isAllowed } from "@/lib/registry/payto-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const author = url.searchParams.get("author");
  const amount = parseFloat(url.searchParams.get("amount") ?? "0");

  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return Response.json({ error: "source not found" }, { status: 404 });

  // payTo must be a real wallet of this source (the source itself or one of its authors)
  const valid =
    author &&
    (author.toLowerCase() === source.walletAddress.toLowerCase() ||
      source.authors.some((a) => a.walletAddress.toLowerCase() === author.toLowerCase()));
  const payTo = valid ? (author as string) : source.walletAddress;

  // Second, independent check against the chain. The DB agreed that `payTo` belongs to
  // this source; the registry decides whether the DB is telling the truth.
  if (source.onchainId) {
    const allowlist = await allowedPayTo(source.onchainId);
    if (allowlist.status === "onchain") {
      if (!isAllowed(allowlist.wallets, payTo)) {
        console.error(
          `[cite] payTo ${payTo} for ${id} is not an on-chain author or payout wallet — refusing to settle`,
        );
        return Response.json(
          { error: "payTo is not authorised for this source on-chain" },
          { status: 403 },
        );
      }
      if (allowlist.stale) {
        console.warn(`[cite] validated ${id} against a stale on-chain allowlist (RPC unreachable)`);
      }
    } else if (allowlist.status === "unavailable") {
      // Never read this source's record, and the chain is down. Refusing here would stop
      // all settlement on an RPC outage; the DB check above still stands.
      console.error(`[cite] on-chain payTo check unavailable for ${id}: ${allowlist.error}`);
    }
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "amount must be > 0" }, { status: 400 });
  }
  // Sanity ceiling: a single citation reward far above any realistic weighted split is a
  // fat-finger or an attempt to skew the leaderboard. The caller self-pays via x402, so this
  // is a bound, not a drain control. Override with KERYX_MAX_CITATION_USDC if a deployment needs it.
  if (amount > config.maxCitationUsdc) {
    return Response.json(
      { error: `amount exceeds ceiling of ${config.maxCitationUsdc} USDC` },
      { status: 400 },
    );
  }

  return settleThenServe(
    req,
    {
      priceUsdc: amount,
      payTo,
      endpoint: `/api/cite/${id}`,
      description: `Citation reward for ${source.name}`,
    },
    () => ({ ok: true, source: source.name, network: config.networkId }),
  );
}
