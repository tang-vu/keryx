/**
 * GET  /api/sources           → list registered sources (public fields only, no auth)
 *   Optional cursor pagination: ?limit=N (1..100) returns a page plus { total, nextCursor };
 *   pass ?cursor= from the previous page to continue. WITHOUT ?limit the response stays the
 *   complete list — the browser payTo allowlist (lib/payments/client-payto-allowlist.ts and
 *   session-payee-policy.ts) refuses to pay any source absent from this index, so the default
 *   must never truncate.
 * POST /api/sources           → register a source; requires a valid SIWE session.
 *   body: { rssUrl?, name?, url?, description?, fetchPrice?, tags?, authors? }
 *
 * Write path (two modes depending on whether the on-chain registry is configured):
 *
 *   Registry configured (KERYX_REGISTRY_ADDRESS set):
 *     The client's connected wallet signs and submits the registry.register() tx.
 *     The server does NOT write a new source row to DB — it arrives via the indexer
 *     within ≤4s after the tx is mined. The server DOES:
 *       1. Claim the derived id on this creator's pre-registry row for the same URL, if one
 *          exists, so the indexer updates it instead of minting a duplicate beside it.
 *       2. Store off-chain metadata (name/url/description/rssUrl) in source_meta keyed by
 *          the derived sourceId so the indexer can merge them on SourceRegistered.
 *       3. Ingest RSS items to DB keyed by the row id so the agent cache is ready.
 *     Returns { mode: "onchain", sourceId, registryAddress, registerParams } where
 *     registerParams contains urlHash (not id) — the contract derives id on-chain.
 *
 *   Registry not configured (offline dev / no env set):
 *     Falls back to DB-direct write. Source row written immediately.
 *     Seed scripts and offline dev are unaffected.
 *
 * The wallet address is always taken from the session — the client-supplied
 * walletAddress field is ignored for authenticated requests to prevent wallet spoofing.
 *
 * Permissionless first-listing: any authenticated wallet may register a source.
 * Registering is what MAKES a wallet a creator (resolveRole then sees it owns a
 * source), so there is no creator precondition — requiring one is an impossible
 * bootstrap and stricter than the on-chain register(), which is itself permissionless.
 */

import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { prepareSourceRegistration } from "@/lib/sources/prepare-registration";
import { paginateSourceList } from "@/lib/sources/paginate-source-list";
import { consumePoint } from "@/lib/rate-limit-store";
import type { Source } from "@/lib/types";
import { recordActivationEvent } from "@/lib/activation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAP_OFFERS_PER_WALLET_PER_DAY = 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function toPublicSource(s: Source) {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    // A feed address is public by construction — it's what anyone polls to read the source.
    // The register page needs it back to pre-fill a claim for a pre-registry row.
    rssUrl: s.rssUrl,
    description: s.description,
    tags: s.tags,
    fetchPrice: s.fetchPrice,
    walletAddress: s.walletAddress,
    authors: s.authors.map((a) => ({ name: a.name, splitWeight: a.splitWeight })),
    onchainId: s.onchainId,
    registerTx: s.registerTx,
    verified: s.verified !== false, // undefined → true (grandfathered)
  };
}

export async function GET(req: NextRequest) {
  const db = await getDb();
  const sources = await db.listSources();

  const limitParam = req.nextUrl.searchParams.get("limit");
  if (limitParam === null) {
    // Default: the complete index. In-app consumers (payTo allowlist, register pre-fill,
    // embed) depend on exhaustiveness, so only an explicit ?limit opts into paging.
    return Response.json({ sources: sources.map(toPublicSource) });
  }

  const limit = Number(limitParam);
  if (!Number.isFinite(limit) || limit < 1) {
    return Response.json({ error: "limit must be a positive integer" }, { status: 400 });
  }

  try {
    const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
    const page = paginateSourceList(sources, { limit, cursor });
    return Response.json({
      sources: page.items.map(toPublicSource),
      total: sources.length,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    });
  } catch {
    return Response.json({ error: "invalid cursor" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  // Require an authenticated session.
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const db = await getDb();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Every accepted wanted-claim offer can authorize one bounded treasury retry. Keep a durable
  // per-wallet daily valve in addition to the database's one-offer-per-gap/owner admission lock.
  if (body.gapId != null || body.matchedItemLink != null) {
    const admitted = await consumePoint(
      session.address.toLowerCase(),
      "gap-offer",
      GAP_OFFERS_PER_WALLET_PER_DAY,
      ONE_DAY_MS,
    );
    if (!admitted.allowed) {
      const retryAfter = Math.max(1, Math.ceil(admitted.msBeforeNext / 1000));
      return Response.json(
        {
          error: "wanted-claim offer limit reached",
          message: "A wallet may submit at most five treasury-retry offers per day.",
          retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  // The wallet address is always taken from the session — a client-supplied walletAddress is
  // ignored to prevent wallet spoofing. Delegate the actual register to the shared core, which the
  // bulk-import route reuses per feed so both paths stay byte-identical.
  const { status, payload } = await prepareSourceRegistration(db, session.address, body);
  if (status >= 200 && status < 300) {
    await recordActivationEvent(db, "creator_registration_started");
  }
  return Response.json(payload, { status });
}
