/**
 * x402 citation settlement. Dynamic price = the agent-computed weighted reward.
 * payTo is the specified author wallet (validated to belong to the source).
 * POST /api/cite/[id]?author=<wallet>&amount=<usdc>&query=<id>
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { config } from "@/lib/config";
import { settleThenServe } from "@/lib/x402-server";

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

  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: "amount must be > 0" }, { status: 400 });
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
