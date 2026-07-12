/**
 * GET  /api/sources           → list registered sources (public fields only, no auth)
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const sources = await db.listSources();
  return Response.json({
    sources: sources.map((s) => ({
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
    })),
  });
}

export async function POST(req: NextRequest) {
  // Require an authenticated session.
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const db = await getDb();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // The wallet address is always taken from the session — a client-supplied walletAddress is
  // ignored to prevent wallet spoofing. Delegate the actual register to the shared core, which the
  // bulk-import route reuses per feed so both paths stay byte-identical.
  const { status, payload } = await prepareSourceRegistration(db, session.address, body);
  return Response.json(payload, { status });
}
