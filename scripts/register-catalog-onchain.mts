/**
 * register-catalog-onchain — publishes the curated source catalog to the on-chain SourceRegistry.
 *
 * WHY: the catalog has always been served from the DB; the registry contract was deployed but
 * never written to. This makes the "on-chain source catalog" real and independently verifiable:
 * each source becomes a genuine register() transaction on Arc (a real EVM hash that resolves on
 * the explorer — unlike Gateway settlement IDs, which are Circle UUIDs).
 *
 * DESIGN — must not disturb live traction:
 *   - Talks to the contract by address directly; does NOT require KERYX_REGISTRY_ADDRESS to be set.
 *     (Setting that env would wake the indexer, which keys cache rows by the on-chain bytes32 id and
 *      would duplicate every DB source under a second id, fracturing the leaderboard. Left off here.)
 *   - Registrant = the source's OWN creator wallet when its key is recoverable (creator == payout,
 *     fully self-consistent); otherwise the treasury funder signs (creator = treasury, still valid —
 *     payoutWallet/authors are independent params, so per-citation payouts are unaffected either way).
 *   - Idempotent: skips sources already present on-chain (get(id).creator != 0).
 *   - Stamps the real onchainId + register tx hash back onto the existing DB row (no id change), so
 *     the UI can link verifiable provenance without the indexer.
 *
 * MUST run where the creator keys + the source-of-truth DB live (the VPS, like the volume engine).
 *
 * Usage:
 *   npm run register-onchain -- --dry-run        (preview; no txs, no gas)
 *   npm run register-onchain                     (register all unregistered sources)
 *   npm run register-onchain -- --limit 3        (register only the first 3 — smoke test)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getDb } from "../lib/db/index.ts";
import { getOrCreateWallet } from "../lib/sources/wallet-store.ts";
import { urlHash, sourceId, REGISTRY_ABI } from "../lib/registry/registry-client.ts";
import { config } from "../lib/config.ts";
import type { Author } from "../lib/types.ts";

const ZERO = "0x0000000000000000000000000000000000000000";
const REGISTRY = (process.env.KERYX_REGISTRY_ADDRESS ??
  "0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536") as Address;
const GAS_MIN = parseEther("0.01"); // native gas USDC (18 decimals on Arc)
const GAS_TOPUP = parseEther("0.03"); // enough for one register() write

// ── args ──
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const limitIdx = argv.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1] ?? "0", 10) : Infinity;

if (!config.funderKey) {
  console.error("✖ AGENT_FUNDER_PRIVATE_KEY (or BUYER_PRIVATE_KEY) required to fund register gas.");
  process.exit(1);
}

const funder = privateKeyToAccount(config.funderKey as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
const funderWallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });

/** Convert float split weights to integer basis points that sum to EXACTLY 10000 (contract reverts otherwise). */
function toBasisPoints(authors: Author[]): { wallet: Address; basisPoints: number }[] {
  const bps = authors.map((a) => Math.max(1, Math.round(a.splitWeight * 10_000)));
  const diff = 10_000 - bps.reduce((x, y) => x + y, 0);
  // Absorb the rounding remainder into the largest share so the total lands on 10000.
  const maxIdx = bps.indexOf(Math.max(...bps));
  bps[maxIdx] += diff;
  if (bps.reduce((x, y) => x + y, 0) !== 10_000 || bps.some((b) => b < 1)) {
    throw new Error(`cannot normalize author splits to 10000 bp: ${JSON.stringify(bps)}`);
  }
  return authors.map((a, i) => ({ wallet: a.walletAddress as Address, basisPoints: bps[i] }));
}

async function ensureGas(addr: Address): Promise<void> {
  if (addr.toLowerCase() === funder.address.toLowerCase()) return; // funder funds itself elsewhere
  const native = await pub.getBalance({ address: addr });
  if (native >= GAS_MIN) return;
  console.log(`   ↳ funding gas ${formatEther(GAS_TOPUP)} → ${addr}`);
  const tx = await funderWallet.sendTransaction({ to: addr, value: GAS_TOPUP });
  await pub.waitForTransactionReceipt({ hash: tx });
}

async function main() {
  const db = await getDb();
  const sources = await db.listSources();
  console.log(`\n⚙  register-catalog-onchain  ·  ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`   registry: ${REGISTRY}  ·  sources: ${sources.length}\n`);

  let registered = 0;
  let skipped = 0;
  let done = 0;

  for (const s of sources) {
    if (done >= limit) break;
    const canonicalUrl = s.url || s.rssUrl || "";
    if (!canonicalUrl) {
      console.log(`–  ${s.id}: no url/rssUrl — cannot derive urlHash, skipping`);
      skipped++;
      continue;
    }

    // Prefer the source's own wallet as registrant (creator == payout). Fall back to treasury.
    const own = getOrCreateWallet(s.id);
    const registrantKey = (
      own.address.toLowerCase() === s.walletAddress.toLowerCase() ? own.privateKey : config.funderKey
    ) as Hex;
    const registrant = privateKeyToAccount(registrantKey);
    const id = sourceId(registrant.address, canonicalUrl);

    // Idempotent: already on-chain → just backfill the DB stamp if missing.
    const rec = (await pub.readContract({
      address: REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "get",
      args: [id],
    })) as { creator: Address };
    if (rec.creator !== ZERO) {
      console.log(`=  ${s.id}: already on-chain (${id.slice(0, 10)}…)`);
      if (!s.onchainId) await db.upsertSource({ ...s, onchainId: id });
      skipped++;
      continue;
    }

    const authors = toBasisPoints(s.authors);
    const fetchPriceUsdc6 = BigInt(Math.round(s.fetchPrice * 1_000_000));
    const tags = (s.tags ?? []).join(",");
    const contentCid = s.ipfsCid ?? "";

    if (dryRun) {
      console.log(
        `▸  ${s.id}: would register by ${registrant.address.slice(0, 8)}… ` +
          `(creator==payout: ${registrant.address.toLowerCase() === s.walletAddress.toLowerCase()}) ` +
          `price=${fetchPriceUsdc6} authors=${authors.length} → id ${id.slice(0, 10)}…`,
      );
      done++;
      continue;
    }

    try {
      await ensureGas(registrant.address);
      const wallet = createWalletClient({ account: registrant, chain: arcTestnet, transport: http(config.rpcUrl) });
      const txHash = await wallet.writeContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "register",
        args: [urlHash(canonicalUrl), s.walletAddress as Address, authors, fetchPriceUsdc6, contentCid, tags],
      });
      await pub.waitForTransactionReceipt({ hash: txHash });
      await db.upsertSource({ ...s, onchainId: id, registerTx: txHash });
      registered++;
      done++;
      console.log(`✓  ${s.id}: ${config.explorerUrl}/tx/${txHash}`);
    } catch (err) {
      console.error(`✖  ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Confirm the on-chain catalog size.
  const count = (await pub.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "sourceCount",
  })) as bigint;

  console.log(`\n✓ Done. registered ${registered} · skipped ${skipped}`);
  console.log(`  on-chain sourceCount() = ${count.toString()}`);
  console.log(`  registry: ${config.explorerUrl}/address/${REGISTRY}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
