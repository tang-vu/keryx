/**
 * prepareSourceRegistration — the core of registering ONE source, shared by:
 *   - POST /api/sources        (single register)
 *   - POST /api/sources/bulk   (batch import: many feeds in one pass)
 *
 * Given an authenticated wallet + a request body, it ingests the feed (or manual
 * fields), writes off-chain metadata + RSS items, and returns the exact JSON the
 * single-register route has always returned — { status, payload }. The route is a
 * thin wrapper; the bulk route calls this once per feed and collects the payloads.
 *
 * Behaviour is identical to the pre-extraction single route: on-chain path when the
 * registry is configured (client submits register() itself), DB-direct otherwise.
 */

import { getDb } from "@/lib/db";
import { createSource, type CreateSourceInput } from "@/lib/sources/create-source";
import { ingestRss } from "@/lib/ingest/rss";
import { config } from "@/lib/config";
import { urlHash, sourceId } from "@/lib/registry/registry-client";
import { claimOnchainIdForExistingSource } from "@/lib/sources/pre-registry-adoption";
import { feedContainsToken, verificationToken } from "@/lib/sources/feed-verification";
import { isDeliverableUrl, randomNotifySecret } from "@/lib/notify/citation-webhook";
import {
  GapOfferError,
  queueGapOffer,
  resolveGapOffer,
} from "@/lib/demand-intent";
import type { SourceItem } from "@/lib/types";
import { storeSourceItems } from "@/lib/sources/store-source-item";

type KeryxDB = Awaited<ReturnType<typeof getDb>>;

export interface PrepareResult {
  status: number;
  payload: Record<string, unknown>;
}

/** Instructions returned to a not-yet-verified registrant: drop this line in the feed, then
 *  POST /api/sources/verify. Until verified, the source is listed but never read/cited/paid. */
function verificationInfo(wallet: string, feedUrl: string | undefined) {
  return {
    token: verificationToken(wallet),
    canVerify: Boolean(feedUrl?.trim()),
    instructions: feedUrl?.trim()
      ? "Add this exact line anywhere in your feed (e.g. the channel <description> or a post), then verify. Until then your source is listed but earns nothing."
      : "Manual sources have no feed to prove ownership, so they stay unverified and off the agent's money path. List via an RSS feed you control to earn.",
  };
}

/** Turn one register request into the response payload the client expects. Never throws for
 *  caller-input problems — those come back as { status >= 400 } so bulk can record them per-feed. */
export async function prepareSourceRegistration(
  db: KeryxDB,
  sessionWallet: string,
  body: Record<string, unknown>,
): Promise<PrepareResult> {
  // Optional notify-on-citation webhook. Validated up-front so a bad URL fails the whole register
  // (not silently dropped). Persisted post-create keyed by source id; the secret is echoed once.
  const notifyUrlRaw = typeof body.notifyUrl === "string" ? body.notifyUrl.trim() : "";
  if (notifyUrlRaw && (notifyUrlRaw.length > 2048 || !isDeliverableUrl(notifyUrlRaw))) {
    return {
      status: 400,
      payload: { error: "notifyUrl must be an absolute http(s) URL under 2048 chars" },
    };
  }
  /** Persist the webhook for the given source id and return the one-time secret echo, or null. */
  const applyNotify = async (sid: string) => {
    if (!notifyUrlRaw) return null;
    const secret = randomNotifySecret();
    await db.setSourceNotify(sid, notifyUrlRaw, secret);
    return { url: notifyUrlRaw, secret };
  };

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
      return { status: 400, payload: { error: "provide rssUrl, or name + description" } };
    }
  } catch (err) {
    return {
      status: 400,
      payload: { error: "ingest failed", message: err instanceof Error ? err.message : String(err) },
    };
  }

  let gapOffer;
  try {
    gapOffer = await resolveGapOffer(
      db,
      body.gapId,
      body.matchedItemLink,
      feedItems,
    );
  } catch (err) {
    if (err instanceof GapOfferError) {
      return { status: 409, payload: { error: err.message } };
    }
    throw err;
  }

  // ── On-chain path (registry configured) ──────────────────────────────────
  if (config.registryAddress) {
    const canonicalUrl = input.url || input.rssUrl || "";
    if (!canonicalUrl) {
      return {
        status: 400,
        payload: { error: "url or rssUrl required when registry is configured" },
      };
    }

    // urlHash is passed to register(); contract derives id = keccak256(abi.encode(creator, urlHash)).
    const uh = urlHash(canonicalUrl);
    // Pre-compute the full id so we can key source_meta and RSS items now.
    const sid = sourceId(sessionWallet as `0x${string}`, canonicalUrl);

    // If this creator listed this source before the registry was switched on, its row carries no
    // registry id and the indexer would mint a second one beside it. Claim the id on that row now,
    // before the tx: it decides which row the event lands on, and therefore which id owns the feed.
    const claimed = await claimOnchainIdForExistingSource(db, sessionWallet, canonicalUrl, sid);
    const rowId = claimed?.id ?? sid;

    // Ingest RSS items to DB now — keyed by the row the indexer will write, so the agent cache
    // is ready before the indexer processes the SourceRegistered event. Item ids are minted fresh
    // and source_items keys on the id alone, so a re-registration would shelve a second copy of
    // every post beside the first. Only posts this row has never seen are new.
    const seen = claimed
      ? new Set((await db.getItems(rowId)).map((i) => i.link).filter(Boolean))
      : new Set<string>();
    const unseen = feedItems.filter((it) => !it.link || !seen.has(it.link));
    if (unseen.length > 0) {
      const items: SourceItem[] = await storeSourceItems(
        unseen.map((it) => ({
          ...it,
          id: crypto.randomUUID(),
          sourceId: rowId,
        })),
      );
      await db.setCached(rowId, "");
      await db.addItems(items);
    }

    // Store metadata only after external content storage succeeds, so a Pinata/key outage cannot
    // advertise a registration payload whose articles never reached the durable boundary.
    // Keyed by the registry id, which is what the indexer has in hand; rssUrl is off-chain only.
    await db.setSourceMeta(sid, {
      name: input.name,
      description: input.description,
      url: canonicalUrl,
      rssUrl: input.rssUrl,
    });

    // fetchPriceUsdc6: convert USDC float → 6-decimal integer (e.g. 0.002 → 2000).
    const fetchPriceUsdc6 = BigInt(
      Math.round((input.fetchPrice ?? config.defaultFetchPrice) * 1_000_000),
    );

    // Build author splits — collect integer basis points directly to avoid float
    // rounding issues (form-side; here we pass through bp as-is).
    // Default: single author at 10_000 bp (100%) to session wallet.
    const authors = input.authors?.length
      ? input.authors.map((a) => ({
          wallet: (a.walletAddress ?? sessionWallet) as `0x${string}`,
          basisPoints: Math.round(a.splitWeight * 10_000),
        }))
      : [{ wallet: sessionWallet as `0x${string}`, basisPoints: 10_000 }];

    return {
      status: 200,
      payload: {
        mode: "onchain",
        // The row's id, which is the hash for a first listing and the original slug for a source
        // that predates the registry. This is what /api/sources/verify expects back.
        sourceId: rowId,
        registryAddress: config.registryAddress,
        notify: await applyNotify(rowId),
        gapIntent: await queueGapOffer(db, gapOffer, rowId, sessionWallet),
        // The indexer writes a NEW row UNVERIFIED — earning needs feed-ownership proof first. A row
        // claimed from before the registry already gave that proof, and must not be asked again.
        verification: claimed?.verified
          ? null
          : verificationInfo(sessionWallet, input.rssUrl || canonicalUrl),
        registerParams: {
          // urlHash is passed to register(); contract derives the sourceId on-chain.
          urlHash: uh,
          payoutWallet: sessionWallet,
          authors,
          fetchPriceUsdc6: fetchPriceUsdc6.toString(), // JSON can't carry BigInt natively
          // Per-article encrypted CIDs live in source_items; this publication-level registry field
          // remains empty until a future immutable catalog manifest is registered on-chain.
          contentCid: "",
          tags: (input.tags ?? []).join(","),
        },
      },
    };
  }

  // ── Offline / DB-direct path (registry not configured) ───────────────────
  // Maintains full backward compatibility: seed scripts, offline dev, and the
  // CLI `npm run ask` all continue to work without a deployed contract.
  //
  // Public web submissions start UNVERIFIED so a wallet can't earn off a feed it doesn't own.
  // Convenience: if the feed ALREADY carries `keryx-verify:<wallet>` at register time, mark it
  // verified immediately (the owner pre-placed the token), skipping the second round-trip.
  const verifiedAtRegister =
    Boolean(input.rssUrl) && (await feedContainsToken(input.rssUrl!, sessionWallet));
  const source = await createSource(db, { ...input, verified: verifiedAtRegister });
  const gapIntent = await queueGapOffer(db, gapOffer, source.id, sessionWallet);
  return {
    status: 200,
    payload: {
      mode: "offline",
      source: {
        id: source.id,
        name: source.name,
        walletAddress: source.walletAddress,
        fetchPrice: source.fetchPrice,
        verified: source.verified,
        authors: source.authors.map((a) => ({ name: a.name, splitWeight: a.splitWeight })),
      },
      notify: await applyNotify(source.id),
      gapIntent,
      verification: verifiedAtRegister ? null : verificationInfo(sessionWallet, input.rssUrl),
    },
  };
}
