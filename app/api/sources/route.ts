/**
 * GET  /api/sources           → list registered sources (public fields only, no auth)
 * POST /api/sources           → register a source; requires a valid SIWE session.
 *   body: { rssUrl?, name?, url?, description?, fetchPrice?, tags?, authors? }
 *
 * Write path (two modes depending on whether the on-chain registry is configured):
 *
 *   Registry configured (KERYX_REGISTRY_ADDRESS set):
 *     The client's connected wallet signs and submits the registry.register() tx.
 *     The server does NOT write the source row to DB — it arrives via the indexer
 *     within ≤4s after the tx is mined. The server DOES:
 *       1. Store off-chain metadata (name/url/description) in source_meta keyed by
 *          the derived sourceId so the indexer can merge them on SourceRegistered (H2).
 *       2. Ingest RSS items to DB keyed by sourceId so the agent cache is ready.
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
import { createSource, type CreateSourceInput } from "@/lib/sources/create-source";
import { ingestRss } from "@/lib/ingest/rss";
import { config } from "@/lib/config";
import { urlHash, sourceId } from "@/lib/registry/registry-client";
import type { SourceItem } from "@/lib/types";

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
      description: s.description,
      tags: s.tags,
      fetchPrice: s.fetchPrice,
      walletAddress: s.walletAddress,
      authors: s.authors.map((a) => ({ name: a.name, splitWeight: a.splitWeight })),
      onchainId: s.onchainId,
      registerTx: s.registerTx,
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
  const sessionWallet = session.address;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Parse and ingest feed / manual fields.
  let input: CreateSourceInput;
  let feedItems: Omit<SourceItem, "id" | "sourceId">[] = [];

  try {
    if (typeof body.rssUrl === "string" && body.rssUrl.trim()) {
      const feed = await ingestRss(body.rssUrl.trim());
      feedItems = feed.items;
      input = {
        name: (body.name as string) || feed.feedTitle,
        url: (body.url as string) || feed.link,
        description: (body.description as string) || feed.feedDescription || feed.feedTitle,
        rssUrl: body.rssUrl.trim(),
        tags: (body.tags as string[]) ?? [],
        fetchPrice: body.fetchPrice ? Number(body.fetchPrice) : undefined,
        walletAddress: sessionWallet,
        authors: (body.authors as CreateSourceInput["authors"]) || undefined,
        items: feed.items,
      };
    } else if (typeof body.name === "string" && typeof body.description === "string") {
      input = {
        name: body.name,
        url: (body.url as string) ?? "",
        description: body.description,
        tags: (body.tags as string[]) ?? [],
        fetchPrice: body.fetchPrice ? Number(body.fetchPrice) : undefined,
        walletAddress: sessionWallet,
        authors: (body.authors as CreateSourceInput["authors"]) || undefined,
        items: (body.items as CreateSourceInput["items"]) || [],
      };
    } else {
      return Response.json(
        { error: "provide rssUrl, or name + description" },
        { status: 400 },
      );
    }
  } catch (err) {
    return Response.json(
      { error: "ingest failed", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  // ── On-chain path (registry configured) ──────────────────────────────────
  if (config.registryAddress) {
    const canonicalUrl = input.url || input.rssUrl || "";
    if (!canonicalUrl) {
      return Response.json(
        { error: "url or rssUrl required when registry is configured" },
        { status: 400 },
      );
    }

    // urlHash is passed to register(); contract derives id = keccak256(abi.encode(creator, urlHash)).
    const uh = urlHash(canonicalUrl);
    // Pre-compute the full id so we can key source_meta and RSS items now.
    const sid = sourceId(sessionWallet as `0x${string}`, canonicalUrl);

    // Store off-chain metadata (name/description/url) so the indexer can merge them
    // when it processes the SourceRegistered event (H2 fix — prevents hex-placeholder display).
    await db.setSourceMeta(sid, {
      name: input.name,
      description: input.description,
      url: canonicalUrl,
    });

    // Ingest RSS items to DB now — keyed by the on-chain sourceId so the agent cache
    // is ready before the indexer processes the SourceRegistered event.
    if (feedItems.length > 0) {
      const items: SourceItem[] = feedItems.map((it) => ({
        ...it,
        id: crypto.randomUUID(),
        sourceId: sid,
      }));
      await db.addItems(items);
    }

    // fetchPriceUsdc6: convert USDC float → 6-decimal integer (e.g. 0.002 → 2000).
    const fetchPriceUsdc6 = BigInt(
      Math.round((input.fetchPrice ?? config.defaultFetchPrice) * 1_000_000),
    );

    // Build author splits — collect integer basis points directly to avoid float
    // rounding issues (M2 fix: form-side; here we pass through bp as-is).
    // Default: single author at 10_000 bp (100%) to session wallet.
    const authors = input.authors?.length
      ? input.authors.map((a) => ({
          wallet: (a.walletAddress ?? sessionWallet) as `0x${string}`,
          basisPoints: Math.round(a.splitWeight * 10_000),
        }))
      : [{ wallet: sessionWallet as `0x${string}`, basisPoints: 10_000 }];

    return Response.json({
      mode: "onchain",
      sourceId: sid,
      registryAddress: config.registryAddress,
      registerParams: {
        // urlHash is passed to register(); contract derives the sourceId on-chain.
        urlHash: uh,
        payoutWallet: sessionWallet,
        authors,
        fetchPriceUsdc6: fetchPriceUsdc6.toString(), // JSON can't carry BigInt natively
        contentCid: "",   // Phase 04 will populate this with the IPFS CID
        tags: (input.tags ?? []).join(","),
      },
    });
  }

  // ── Offline / DB-direct path (registry not configured) ───────────────────
  // Maintains full backward compatibility: seed scripts, offline dev, and the
  // CLI `npm run ask` all continue to work without a deployed contract.
  const source = await createSource(db, input);
  return Response.json({
    mode: "offline",
    source: {
      id: source.id,
      name: source.name,
      walletAddress: source.walletAddress,
      fetchPrice: source.fetchPrice,
      authors: source.authors.map((a) => ({ name: a.name, splitWeight: a.splitWeight })),
    },
  });
}
