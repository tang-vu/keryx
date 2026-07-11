/**
 * parity.ts — audits the WHOLE on-chain SourceRegistry against the DB cache.
 *
 * The indexer projects chain events into the `sources` table, and settlement pays whoever
 * that table says (guarded per-payment by payto-guard). This module is the sweep that proves
 * the projection is still faithful: it enumerates every on-chain record via the contract's
 * public `sourceIds` array and field-compares the money-path columns — payout wallet, author
 * splits, fetch price, active flag — against the cached row.
 *
 * Ran hourly by scripts/check-registry.mts (cron), summarized on /status via /api/health.
 * A mismatch means either an indexer defect or a tampered cache — both are alert-worthy.
 *
 * Transient note: a source registered seconds before the sweep may not be indexed yet
 * (4s poll). The report carries head vs lastSyncedBlock so a lagging index is visible,
 * and the hourly cadence means a real defect persists across runs while a race does not.
 */

import { createPublicClient, http, type Address, type Hex } from "viem";
import { arcTestnet } from "@/lib/chains";
import { config } from "@/lib/config";
import { REGISTRY_ABI, type OnChainRecord } from "./registry-client";
import type { KeryxDB } from "@/lib/db/keryx-db";
import type { Source } from "@/lib/types";

/** sync_state key the watchdog writes its latest summary under; /api/health reads it. */
export const PARITY_STATE_KEY = "registryParity";

/** One field-level disagreement between the chain record and the cached row. */
export interface ParityIssue {
  onchainId: string;
  /** Cache row id when a row exists (pre-registry rows use a slug, not the hash). */
  rowId?: string;
  field: "row" | "payoutWallet" | "fetchPrice" | "active" | "authors";
  chain: string;
  cache: string;
}

export interface ParityReport {
  checkedAt: string;
  /** Total ids in the contract's enumeration array (includes deactivated records). */
  chainCount: number;
  /** Records actually read back and compared. */
  comparedCount: number;
  issues: ParityIssue[];
  headBlock: string;
  lastSyncedBlock: string | null;
}

/** Compact summary persisted to sync_state — /status needs counts, not field diffs. */
export interface ParitySummary {
  checkedAt: string;
  chainCount: number;
  comparedCount: number;
  issueCount: number;
  lastSyncedBlock: string | null;
}

/** Chain reads the audit needs — injectable so tests never touch an RPC. */
export interface RegistryReader {
  headBlock(): Promise<bigint>;
  sourceCount(): Promise<bigint>;
  sourceIdAt(index: bigint): Promise<Hex>;
  get(id: Hex): Promise<OnChainRecord | null>;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Default reader against the real registry. Bounded RPC so a hung node fails the cron fast. */
export function chainRegistryReader(): RegistryReader {
  const address = config.registryReadAddress as Address;
  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }),
  });
  return {
    headBlock: () => client.getBlockNumber(),
    sourceCount: () =>
      client.readContract({ address, abi: REGISTRY_ABI, functionName: "sourceCount" }),
    sourceIdAt: (index) =>
      client.readContract({ address, abi: REGISTRY_ABI, functionName: "sourceIds", args: [index] }),
    get: async (id) => {
      const record = await client.readContract({
        address, abi: REGISTRY_ABI, functionName: "get", args: [id],
      });
      return record.creator === ZERO_ADDRESS ? null : (record as OnChainRecord);
    },
  };
}

/**
 * Field-compares one cached row against its on-chain record. Pure — the unit under test.
 * Wallet comparisons are case-insensitive; price and splits compare in integer units
 * (micro-USDC, basis points) so float representation of the cache can never false-alarm.
 */
export function compareRecord(row: Source, record: OnChainRecord): ParityIssue[] {
  const issues: ParityIssue[] = [];
  const base = { onchainId: row.onchainId ?? "", rowId: row.id };

  if (row.walletAddress.toLowerCase() !== record.payoutWallet.toLowerCase()) {
    issues.push({ ...base, field: "payoutWallet", chain: record.payoutWallet, cache: row.walletAddress });
  }

  const chainPrice = Number(record.fetchPriceUsdc6);
  const cachePrice = Math.round(row.fetchPrice * 1_000_000);
  if (chainPrice !== cachePrice) {
    issues.push({ ...base, field: "fetchPrice", chain: `${chainPrice}µ`, cache: `${cachePrice}µ` });
  }

  // Cache rows predating the active column default to true — same rule listSources() applies.
  const cacheActive = row.active !== false;
  if (record.active !== cacheActive) {
    issues.push({ ...base, field: "active", chain: String(record.active), cache: String(cacheActive) });
  }

  const chainSplits = new Map(record.authors.map((a) => [a.wallet.toLowerCase(), a.basisPoints]));
  const cacheSplits = new Map(
    row.authors.map((a) => [a.walletAddress.toLowerCase(), Math.round(a.splitWeight * 10_000)]),
  );
  const splitsMatch =
    chainSplits.size === cacheSplits.size &&
    [...chainSplits].every(([wallet, bp]) => cacheSplits.get(wallet) === bp);
  if (!splitsMatch) {
    const fmt = (m: Map<string, number>) =>
      [...m].map(([w, bp]) => `${w.slice(0, 6)}…:${bp}bp`).join(" ") || "(none)";
    issues.push({ ...base, field: "authors", chain: fmt(chainSplits), cache: fmt(cacheSplits) });
  }

  return issues;
}

type ParityDb = Pick<KeryxDB, "getSourceByOnchainId" | "getSyncState">;

/**
 * Reads every record off the registry and compares each against its cached row.
 * An ACTIVE chain record with no row is drift (the agent can't pay a source it can't see);
 * an inactive one without a row is by design — the indexer skips those on initial index.
 */
export async function auditRegistryParity(db: ParityDb, reader: RegistryReader): Promise<ParityReport> {
  const [head, count] = await Promise.all([reader.headBlock(), reader.sourceCount()]);

  const indices = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const ids = await Promise.all(indices.map((i) => reader.sourceIdAt(i)));
  const records = await Promise.all(ids.map((id) => reader.get(id)));

  const issues: ParityIssue[] = [];
  let compared = 0;

  for (let i = 0; i < ids.length; i++) {
    const record = records[i];
    if (!record) continue; // enumeration returned an id the contract no longer resolves — impossible by construction
    compared++;

    const row = await db.getSourceByOnchainId(ids[i]);
    if (!row) {
      if (record.active) {
        issues.push({ onchainId: ids[i], field: "row", chain: "active record", cache: "missing" });
      }
      continue;
    }
    issues.push(...compareRecord(row, record));
  }

  return {
    checkedAt: new Date().toISOString(),
    chainCount: Number(count),
    comparedCount: compared,
    issues,
    headBlock: head.toString(),
    lastSyncedBlock: await db.getSyncState("lastSyncedBlock"),
  };
}

/** The compact form the watchdog persists and /api/health serves. */
export function summarize(report: ParityReport): ParitySummary {
  return {
    checkedAt: report.checkedAt,
    chainCount: report.chainCount,
    comparedCount: report.comparedCount,
    issueCount: report.issues.length,
    lastSyncedBlock: report.lastSyncedBlock,
  };
}
