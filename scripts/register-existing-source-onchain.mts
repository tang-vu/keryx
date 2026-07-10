/**
 * Registers a source that already exists in the cache onto the on-chain SourceRegistry.
 *
 * Sources listed before the registry was switched on carry no `onchain_id`, and the payTo guard
 * only consults the chain for sources that have one — so their payouts are still validated against
 * a mutable database row. This backfills them.
 *
 * Order matters. The row's `onchain_id` is written *before* the transaction, because the id is a
 * pure function of (creator, url) and needs no chain to compute. If the SourceRegistered event
 * landed first, the indexer would find no row carrying that id and mint a second one beside the
 * real source.
 *
 * The creator is the source's own payout wallet, so only a source whose key this host holds can be
 * backfilled here. A creator-owned source must be registered by its owner, from their own wallet.
 *
 * Safe to re-run. A row whose id was written but whose transaction never landed is retried; one
 * whose transaction did land is reconciled against the chain rather than re-sent.
 *
 * Usage:
 *   npm run register-onchain -- <source-id> [<source-id> …]
 *   npm run register-onchain -- --all        (every source that carries no registry id yet)
 */

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { getDb } from "../lib/db/index.ts";
import { config } from "../lib/config.ts";
import {
  REGISTRY_ABI,
  getRegistrySource,
  sourceId,
  urlHash,
} from "../lib/registry/registry-client.ts";
import { findWallet } from "../lib/sources/wallet-store.ts";
import type { Author, Source } from "../lib/types.ts";

/** Enough native USDC for a register() call on Arc, with room to spare. */
const GAS_FLOOR = parseEther("0.02");

const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });

/**
 * On-chain splits are integer basis points that must sum to exactly 10 000. Rounding each weight
 * independently can leave the sum a point short or long, so the last author absorbs the remainder.
 */
function toBasisPoints(authors: Author[]): { wallet: Hex; basisPoints: number }[] {
  if (authors.length === 0) throw new Error("source has no authors to split its rewards between");
  const split = authors.map((a) => ({
    wallet: a.walletAddress as Hex,
    basisPoints: Math.round(a.splitWeight * 10_000),
  }));
  const drift = 10_000 - split.reduce((sum, a) => sum + a.basisPoints, 0);
  if (drift !== 0) split[split.length - 1].basisPoints += drift;
  return split;
}

/** Top the creator wallet up from the funder so it can pay for its own register() call. */
async function ensureGas(creator: Hex): Promise<void> {
  const balance = await publicClient.getBalance({ address: creator });
  if (balance >= GAS_FLOOR) return;

  if (!config.funderKey) throw new Error(`${creator} has no gas and no funder key is configured`);
  const funder = createWalletClient({
    account: privateKeyToAccount(config.funderKey as Hex),
    chain: arcTestnet,
    transport: http(config.rpcUrl),
  });
  const hash = await funder.sendTransaction({
    to: creator,
    value: GAS_FLOOR - balance,
    gas: BigInt(21000),
  });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  console.log(`  funded ${creator} with ${formatEther(GAS_FLOOR - balance)} USDC for gas`);
}

async function register(source: Source): Promise<void> {
  if (source.onchainId && source.registerTx) {
    console.log(`  already on-chain (${source.onchainId.slice(0, 12)}…) — skipping`);
    return;
  }
  const canonicalUrl = source.url || source.rssUrl;
  if (!canonicalUrl) throw new Error("source has neither url nor rssUrl to hash");

  const creator = source.walletAddress as Hex;
  // findWallet, not getOrCreateWallet: minting a fresh key for a source we cannot register would
  // leave a useless entry in the keystore.
  const stored = findWallet(source.id);
  if (!stored || stored.address.toLowerCase() !== creator.toLowerCase()) {
    throw new Error(`this host does not hold the key for ${creator} — its owner must register it`);
  }

  const id = sourceId(creator, canonicalUrl);
  const db = await getDb();

  // An earlier attempt may have written the id and then died — before its transaction, or after it.
  // Only the chain knows which, and re-sending register() for a record that already exists would
  // just revert. Reconcile the row instead, and let a genuinely unregistered source fall through.
  if (await getRegistrySource(id)) {
    await db.upsertSource({ ...source, onchainId: id });
    console.log(`  id ${id} — already on the registry, row reconciled`);
    return;
  }

  // Written first: the indexer resolves rows by on-chain id, and a SourceRegistered event arriving
  // before this would look like a source it has never seen.
  await db.upsertSource({ ...source, onchainId: id });
  console.log(`  id ${id}`);

  await ensureGas(creator);

  const wallet = createWalletClient({
    account: privateKeyToAccount(stored.privateKey as Hex),
    chain: arcTestnet,
    transport: http(config.rpcUrl),
  });
  const hash = await wallet.writeContract({
    address: config.registryAddress as Hex,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [
      urlHash(canonicalUrl),
      creator,
      toBasisPoints(source.authors),
      BigInt(Math.round(source.fetchPrice * 1_000_000)),
      source.ipfsCid ?? "",
      source.tags.join(","),
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`register() reverted (${hash})`);

  await db.upsertSource({ ...source, onchainId: id, registerTx: hash });
  console.log(`  registered in block ${receipt.blockNumber} — ${hash}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (!config.registryAddress) throw new Error("KERYX_REGISTRY_ADDRESS is not set");

  const db = await getDb();
  const ids = args.includes("--all")
    ? (await db.listSources()).filter((s) => !s.onchainId).map((s) => s.id)
    : args.filter((a) => !a.startsWith("-"));
  if (ids.length === 0) {
    throw new Error("usage: npm run register-onchain -- <source-id> … | --all");
  }

  for (const id of ids) {
    console.log(`\n${id}`);
    const source = await db.getSource(id);
    if (!source) {
      console.log("  no such source — skipping");
      continue;
    }
    try {
      await register(source);
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await main();
