/**
 * Listing controls for a single source — owner-only.
 *
 *   GET  /api/creator/[id]/listing  → current price + active flag, and for on-chain sources the
 *                                     verbatim registry record the owner's wallet needs to build
 *                                     its own update()/deactivate() calls
 *   POST /api/creator/[id]/listing  → DB-direct mutation for OFFLINE sources only;
 *                                     body { fetchPrice } or { action: "deactivate" }
 *
 * On-chain sources are never mutated here. Price and active live in the SourceRegistry; the
 * creator signs update()/deactivate() from their own wallet (the contract's onlyCreator does the
 * real gating) and the indexer projects the event back into the cache within seconds. A DB-side
 * write would silently diverge from chain and trip the parity watchdog.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { ownsSource } from "@/lib/sources/source-ownership";
import { getRegistrySource } from "@/lib/registry/registry-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sane price band for the DB-direct path. Wider than the UI slider on purpose: an existing
// off-band price (seed rows go as low as $0.002) must stay settable, but a fat-fingered $5/read
// would only get the source skipped by every budget, so cap it.
const MIN_PRICE_USDC = 0.0001;
const MAX_PRICE_USDC = 0.05;

async function loadOwned(id: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const db = await getDb();
  const source = await db.getSource(id);
  if (!source) return { error: NextResponse.json({ error: "source not found" }, { status: 404 }) };
  if (!ownsSource(source, session.address)) {
    return { error: NextResponse.json({ error: "not your source" }, { status: 403 }) };
  }
  return { db, source };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;
  const { source } = owned;

  if (!source.onchainId) {
    return NextResponse.json({
      mode: "offline",
      fetchPrice: source.fetchPrice,
      active: source.active !== false,
    });
  }

  if (!config.registryAddress) {
    return NextResponse.json(
      { error: "This source lives on-chain but registry write mode is off on this deployment." },
      { status: 409 },
    );
  }

  // Chain is the source of truth for everything update() rewrites — read the record live so the
  // client resubmits the current payout/authors/tags verbatim with only the price swapped.
  let record;
  try {
    record = await getRegistrySource(source.onchainId as Hex);
  } catch {
    return NextResponse.json(
      { error: "Registry unreachable — try again in a moment." },
      { status: 502 },
    );
  }
  if (!record) {
    return NextResponse.json(
      { error: "On-chain record not found for this source." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    mode: "onchain",
    fetchPrice: Number(record.fetchPriceUsdc6) / 1_000_000,
    active: record.active,
    registryAddress: config.registryAddress,
    onchainId: source.onchainId,
    // Only this wallet's update()/deactivate() will pass the contract's onlyCreator check.
    creator: record.creator,
    current: {
      payoutWallet: record.payoutWallet,
      authors: record.authors.map((a) => ({ wallet: a.wallet, basisPoints: a.basisPoints })),
      fetchPriceUsdc6: record.fetchPriceUsdc6.toString(), // JSON can't carry BigInt
      contentCid: record.contentCid,
      tags: record.tags,
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await loadOwned(id);
  if (owned.error) return owned.error;
  const { db, source } = owned;

  if (source.onchainId) {
    return NextResponse.json(
      { error: "This source lives on-chain — sign the update from your wallet instead." },
      { status: 409 },
    );
  }
  if (source.active === false) {
    return NextResponse.json({ error: "This source is delisted." }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "deactivate") {
    await db.upsertSource({ ...source, active: false });
    return NextResponse.json({ active: false });
  }

  const price = Number(body.fetchPrice);
  if (!Number.isFinite(price) || price < MIN_PRICE_USDC || price > MAX_PRICE_USDC) {
    return NextResponse.json(
      { error: `fetchPrice must be between ${MIN_PRICE_USDC} and ${MAX_PRICE_USDC} USDC` },
      { status: 400 },
    );
  }
  // Round to whole micro-USDC — the settlement layer allocates in 6-decimal integer units.
  const fetchPrice = Math.round(price * 1_000_000) / 1_000_000;
  await db.upsertSource({ ...source, fetchPrice });
  return NextResponse.json({ fetchPrice });
}
