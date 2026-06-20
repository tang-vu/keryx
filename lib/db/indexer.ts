/**
 * indexer.ts — projects SourceRegistry on-chain events into the KeryxDB cache.
 *
 * Strategy: getLogs polling (4s interval, 500-block chunks). Simpler than watchContractEvent
 * on HTTP transport (which falls back to per-block polling anyway) and gives explicit
 * checkpoint control so restarts resume cleanly from `lastSyncedBlock` in sync_state.
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
 * (written by POST /api/sources at register time) and fills name/description/url from
 * there. Payment-critical fields (payoutWallet, authors, fetchPrice) always come from
 * chain. If metadata is missing, short placeholders are used (not hex id slice).
 *
 * Active flag: SourceDeactivated sets active=false via a real Source field.
 * listSources() filters active=true, so deactivated sources are never surfaced to the agent.
 */

import { createPublicClient, http, type Address, type Log } from "viem";
import { arcTestnet } from "@/lib/chains";
import { config } from "@/lib/config";
import { REGISTRY_ABI, getRegistrySource } from "@/lib/registry/registry-client";
import type { KeryxDB } from "./keryx-db";
import type { Author, Source } from "@/lib/types";

// BigInt() constructor used instead of `500n` literal — tsconfig targets ES2017 which
// predates BigInt literal syntax (ES2020+), though BigInt itself is available at runtime.
const CHUNK_SIZE = BigInt(500);
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

  for (let lo = from; lo <= head; lo += CHUNK_SIZE) {
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

      // Map on-chain basis-point splits → Author.splitWeight = basisPoints / 10_000.
      // Stored as float in the cache (Source interface).
      // TODO: settle from on-chain bp directly (contract.get(id).authors[i].basisPoints),
      // not from the float splitWeight in the cache, to avoid any rounding drift.
      const authors: Author[] = record.authors.map((a) => ({
        name: a.wallet, // overridden below if source_meta has author names
        walletAddress: a.wallet,
        splitWeight: a.basisPoints / 10_000,
      }));

      // Tags stored on-chain as comma-separated string; split for the cache array.
      const tags = record.tags
        ? record.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

      // Read off-chain metadata written by POST /api/sources at register time.
      // Payment fields always come from chain; name/description/url come from source_meta.
      // Falls back to short non-hex placeholders if metadata is not yet available.
      const meta = await db.getSourceMeta(id);

      const source: Source = {
        id,
        name: meta?.name || `source-${id.slice(2, 8)}`,  // short non-hex fallback
        url: meta?.url || "",
        description: meta?.description || "",
        walletAddress: record.payoutWallet,
        fetchPrice,
        tags,
        authors,
        active: true,
        createdAt: new Date().toISOString(),
        ipfsCid: record.contentCid || undefined,
      };

      await db.upsertSource(source);
    } else if (eventName === "SourceDeactivated") {
      const args = (log as { args?: Record<string, unknown> }).args ?? {};
      const id = args["id"] as string | undefined;
      if (!id) continue;

      // Read existing row and re-upsert with active=false.
      // Preserves all human-readable fields; only flips the active flag.
      // If the row doesn't exist yet (e.g. indexer missed the Register event due to
      // a prior RPC failure and the chunk was retried), skip — the Register retry
      // will set active from the on-chain record which already has active=false.
      const existing = await db.getSource(id);
      if (existing) {
        await db.upsertSource({ ...existing, active: false });
      }
    }
  }
}

let _started = false;

/**
 * Start the background polling loop. Safe to call multiple times — idempotent via guard.
 * Returns a cleanup function that stops the interval (useful for tests).
 */
export function startIndexer(db: KeryxDB, intervalMs = 4_000): () => void {
  if (_started) return () => {};
  _started = true;

  let running = false;
  const timerId = setInterval(async () => {
    if (running) return; // skip if previous pass is still in flight
    running = true;
    try {
      await syncOnce(db);
    } catch (err) {
      // Log errors but don't crash the server — next tick will retry from last checkpoint.
      console.error("[keryx indexer]", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, intervalMs);

  return () => {
    clearInterval(timerId);
    _started = false;
  };
}
