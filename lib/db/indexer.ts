/**
 * indexer.ts — projects SourceRegistry on-chain events into the KeryxDB cache.
 *
 * Strategy: event-driven, checkpoint-backed. A WebSocket log subscription (see
 * indexer-event-subscription.ts) wakes a checkpointed getLogs pass the moment the registry
 * emits; a slow heartbeat poll backstops WS drops. All writes flow through the one getLogs
 * path, so restarts resume cleanly from `lastSyncedBlock` in sync_state and a missed push
 * can never lose an event.
 *
 * Arc testnet has deterministic BFT finality — no reorgs are possible. Events are indexed
 * immediately once visible in getLogs results, with zero confirmation-depth logic.
 *
 * Offline dev: `config.registryAddress` unset → syncOnce() returns immediately, no-op.
 *
 * Checkpoint safety: getRegistrySource() now throws on RPC error instead of
 * returning null. applyLogs() propagates the throw, syncOnce() does NOT advance the
 * checkpoint past the failed chunk, and the next tick retries from the same fromBlock.
 * Idempotent upsert makes retry safe.
 *
 * Off-chain metadata merge: on SourceRegistered, the indexer reads source_meta
 * (written by POST /api/sources at register time) and fills name/description/url/rssUrl
 * from there. Payment-critical fields (payoutWallet, authors, fetchPrice) always come from
 * chain. If metadata is missing, short placeholders are used (not hex id slice).
 *
 * Active flag: SourceDeactivated sets active=false via a real Source field.
 * listSources() filters active=true, so deactivated sources are never surfaced to the agent.
 */

import { createPublicClient, http, type Address, type Log } from "viem";
import { arcTestnet } from "@/lib/chains";
import { config } from "@/lib/config";
import { REGISTRY_ABI, getRegistrySource } from "@/lib/registry/registry-client";
import { subscribeRegistryLogs } from "./indexer-event-subscription";
import type { KeryxDB } from "./keryx-db";
import type { Author, Source } from "@/lib/types";

// BigInt() constructor used instead of a `10000n` literal — tsconfig targets ES2017, which predates
// BigInt literal syntax (ES2020+), though BigInt itself is available at runtime.
// 10_000 is the widest span Arc's public RPC serves; 50_000 is refused. At 500 a cold start from the
// deploy block would have cost ~7,000 getLogs calls in a single pass.
const CHUNK_SIZE = BigInt(10_000);
// Chunks per pass. A cold or long-stalled index catches up over several ticks instead of hammering
// the RPC in one unbounded loop — each pass still checkpoints, so no ground is re-covered.
const MAX_CHUNKS_PER_PASS = 20;
const SYNC_KEY = "lastSyncedBlock";

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(config.rpcUrl),
  });
}

/**
 * Run one sync pass: fetch all new registry events from lastSyncedBlock+1 → head,
 * apply them to the cache, and checkpoint after each SUCCESSFULLY processed chunk.
 * If applyLogs throws (RPC error mid-chunk), setSyncState is NOT called — the next
 * tick retries from the same fromBlock.
 * No-op when registryAddress is not configured (offline dev mode).
 */
export async function syncOnce(db: KeryxDB): Promise<void> {
  if (!config.registryAddress) return;

  const client = getPublicClient();
  const head = await client.getBlockNumber();

  const lastRaw = await db.getSyncState(SYNC_KEY);
  const lastSynced = lastRaw !== null ? BigInt(lastRaw) : BigInt(config.registryDeployBlock ?? 0);

  const from = lastSynced + BigInt(1);
  if (from > head) return;

  let chunks = 0;
  for (let lo = from; lo <= head; lo += CHUNK_SIZE) {
    if (chunks++ >= MAX_CHUNKS_PER_PASS) return; // the next tick resumes from the checkpoint
    const hi = lo + CHUNK_SIZE - BigInt(1) < head ? lo + CHUNK_SIZE - BigInt(1) : head;

    const logs = await client.getLogs({
      address: config.registryAddress as Address,
      events: REGISTRY_ABI.filter(
        (e): e is (typeof REGISTRY_ABI)[number] & { type: "event" } => e.type === "event",
      ),
      fromBlock: lo,
      toBlock: hi,
    });

    // applyLogs throws if any RPC call fails — do NOT advance checkpoint on error.
    await applyLogs(logs, db);
    await db.setSyncState(SYNC_KEY, hi.toString());
  }
}

/**
 * Map raw viem log events to Source cache rows and upsert them.
 *
 * SourceRegistered / SourceUpdated:
 *   - Payment fields (payoutWallet, authors, fetchPrice, contentCid, active) from chain.
 *   - Human-readable fields (name, description, url) merged from source_meta table.
 *   - getRegistrySource() throws on RPC error — propagates up so checkpoint does not advance.
 *
 * SourceDeactivated:
 *   - Sets active=false on the cached row via a targeted upsert.
 *   - Uses a partial update that preserves existing human-readable fields.
 *
 * A source is found by its on-chain id first, and only then by the row id. Sources registered on
 * Arc before this cache existed carry human-readable slug ids with the hash in `onchain_id`; keying
 * a row by the hash alone would mint a second row beside them on the first `SourceUpdated`, and a
 * `SourceDeactivated` would sail past the real one.
 */
export async function applyLogs(logs: Log[], db: KeryxDB): Promise<void> {
  for (const log of logs) {
    const eventName = (log as { eventName?: string }).eventName;

    if (eventName === "SourceRegistered" || eventName === "SourceUpdated") {
      const args = (log as { args?: Record<string, unknown> }).args ?? {};
      const id = args["id"] as `0x${string}` | undefined;
      if (!id) continue;

      // getRegistrySource now throws on RPC error — propagates to syncOnce.
      const record = await getRegistrySource(id);
      // Record not found (zero-address creator) means the event is stale or mismatched.
      // Skip inactive records on initial index — SourceDeactivated will handle them.
      if (!record || !record.active) continue;

      // fetchPriceUsdc6 is in 6-decimal USDC units; convert to float USDC for the cache layer.
      const fetchPrice = Number(record.fetchPriceUsdc6) / 1_000_000;

      const existing = await resolveSource(db, id);

      // Map on-chain basis-point splits → Author.splitWeight = basisPoints / 10_000, stored as a
      // float in the cache. The float is lossless for payouts: settlement allocates the reward in
      // integer micro-USDC (allocateSplit) so the legs sum to exactly the reward regardless of any
      // float representation of the weights — no per-payout rounding drift downstream.
      // Author names are off-chain; carry over the one this row already had for that wallet.
      const knownNames = new Map(
        (existing?.authors ?? []).map((a) => [a.walletAddress.toLowerCase(), a.name]),
      );
      const authors: Author[] = record.authors.map((a) => ({
        name: knownNames.get(a.wallet.toLowerCase()) ?? a.wallet,
        walletAddress: a.wallet,
        splitWeight: a.basisPoints / 10_000,
      }));

      // Tags stored on-chain as comma-separated string; split for the cache array.
      const tags = record.tags
        ? record.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      // Read off-chain metadata written by POST /api/sources at register time.
      // Payment fields always come from chain; name/description/url come from source_meta.
      const meta = await db.getSourceMeta(id);

      const source: Source = {
        // Keep the id the row already has. Sources that predate this cache use a slug.
        id: existing?.id ?? id,
        name: meta?.name || existing?.name || `source-${id.slice(2, 8)}`, // short non-hex fallback
        url: meta?.url || existing?.url || "",
        description: meta?.description || existing?.description || "",
        // Not on-chain. A first-time registrant's feed arrives via source_meta; an existing row
        // already knows its own. Losing it strands the source: verification would then check the
        // site's homepage for a token the creator placed in the feed.
        rssUrl: meta?.rssUrl || existing?.rssUrl,
        walletAddress: record.payoutWallet,
        fetchPrice,
        tags,
        authors,
        active: true,
        // On-chain register() is the same permissionless squatting vector as the web form, so a
        // freshly-indexed source starts UNVERIFIED (off the agent's money path until its owner
        // proves feed control via POST /api/sources/verify). Re-indexing must never downgrade an
        // already-verified row.
        verified: existing?.verified ?? false,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        ipfsCid: record.contentCid || undefined,
        // Without this the row would carry no registry id, and the payTo guard — which only
        // consults the chain for sources that have one — would quietly wave its payouts through.
        onchainId: id,
        registerTx: existing?.registerTx ?? (log as { transactionHash?: string }).transactionHash,
      };

      await db.upsertSource(source);
    } else if (eventName === "SourceDeactivated") {
      const args = (log as { args?: Record<string, unknown> }).args ?? {};
      const id = args["id"] as string | undefined;
      if (!id) continue;

      // Re-upsert with active=false, preserving every off-chain field.
      // If the row doesn't exist yet (e.g. the indexer missed the Register event due to an RPC
      // failure and the chunk was retried), skip — the Register retry sets active from the
      // on-chain record, which already reads false.
      const existing = await resolveSource(db, id);
      if (existing) {
        await db.upsertSource({ ...existing, active: false });
      }
    }
  }
}

/**
 * The row this on-chain id belongs to: by registry id first, then by row id for the rows the
 * indexer minted itself (those are keyed by the hash, having never had a slug).
 */
async function resolveSource(db: KeryxDB, onchainId: string): Promise<Source | null> {
  return (await db.getSourceByOnchainId(onchainId)) ?? (await db.getSource(onchainId));
}

let _started = false;

/**
 * Start the background indexer. Event-driven with a safety net:
 *   - a WebSocket log subscription wakes a sync pass the moment the registry
 *     emits (see indexer-event-subscription.ts) — near-instant discovery;
 *   - a slow heartbeat poll covers WS drops and anything the socket missed —
 *     the checkpoint means a heartbeat that finds nothing new costs one
 *     getBlockNumber call, and one that finds ground re-covers none of it.
 * Safe to call multiple times — idempotent via guard.
 * Returns a cleanup function that stops both channels (useful for tests).
 */
export function startIndexer(db: KeryxDB, heartbeatMs = 30_000): () => void {
  if (_started) return () => {};
  _started = true;

  let running = false;
  let pending = false;
  const sync = async () => {
    if (running) {
      // A push landed mid-pass: the pass in flight already fixed its head, so
      // remember to run once more instead of waiting out the heartbeat.
      pending = true;
      return;
    }
    running = true;
    try {
      await syncOnce(db);
    } catch (err) {
      // Log errors but don't crash the server — the next wake retries from last checkpoint.
      console.error("[keryx indexer]", err instanceof Error ? err.message : err);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void sync();
      }
    }
  };

  const unsubscribe = subscribeRegistryLogs(() => void sync());
  const timerId = setInterval(() => void sync(), heartbeatMs);
  void sync(); // catch up immediately on boot instead of waiting a heartbeat

  return () => {
    clearInterval(timerId);
    unsubscribe();
    _started = false;
  };
}
