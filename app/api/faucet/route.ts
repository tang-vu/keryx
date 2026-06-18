/**
 * POST /api/faucet
 *
 * Drips testnet USDC to the authenticated user's wallet — once per address.
 * Requires a valid SIWE session (keryx_session JWT cookie) so anonymous callers
 * can't drain the funder wallet.
 *
 * ONE USDC, one transfer. On Arc, USDC IS the native gas token — the ERC-20 at
 * config.usdcAddress (0x3600…, 6 decimals) is just a 6-decimal interface over the
 * SAME native balance (verified: a wallet's getBalance/1e18 == balanceOf/1e6). So a
 * single native transfer credits USDC that is spendable BOTH as gas and via the
 * ERC-20 interface (x402 / Gateway). The previous two-transfer design was wrong: the
 * ERC-20 EOA→EOA transfer via the precompile reverted, and the receipt status went
 * unchecked, so the route reported a false "Dripped".
 *
 * Drain protections:
 *   1. SIWE gate (authenticated wallets only).
 *   2. Per-address claim tracking — in-memory fast-path + DB persistence so one
 *      claim per address survives server restarts and redeploys (sync_state rows
 *      keyed by "faucet:<address>").
 *   3. Global rate limit (RateLimiterMemory).
 *   4. Funder balance check before the drip; clear error + Circle faucet link on low funds.
 *
 * Amount: KERYX_FAUCET_USDC (default 2) — covers gas for register/grant/deposit txs plus
 * a small session budget. Receipt status is verified; a revert rolls back the claim.
 */

import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { getSession } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const DRIP = parseEther(process.env.KERYX_FAUCET_USDC ?? "2"); // native USDC (18dp)
const FUNDER_BUFFER = parseEther("0.05"); // keep enough for the funder's own gas
const CIRCLE_FAUCET = "https://faucet.circle.com/";

// In-memory fast-path cache — avoids a DB round-trip for the common case.
// DB is the source of truth; this cache is populated lazily on first claim check.
const claimed = new Map<string, number>();
// Shared bucket: max 5 drips/min across all callers.
const limiter = new RateLimiterMemory({ points: 5, duration: 60, keyPrefix: "faucet" });

/** DB key for a faucet claim. */
function faucetKey(address: string): string {
  return `faucet:${address}`;
}

function disabled(reason: string) {
  return NextResponse.json({ error: reason, faucet: CIRCLE_FAUCET }, { status: 503 });
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const address = session.address.toLowerCase();

  try {
    await limiter.consume("global");
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      return NextResponse.json(
        { error: "faucet busy — try again shortly", retryAfter, faucet: CIRCLE_FAUCET },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    // Fail open on unexpected limiter error.
  }

  // In-memory fast-path — eliminates DB read on subsequent requests within the same process.
  if (claimed.has(address)) {
    return NextResponse.json(
      {
        error: "already claimed",
        claimedAt: new Date(claimed.get(address)!).toISOString(),
        message: "Each address may claim once. Use the Circle faucet for more.",
        faucet: CIRCLE_FAUCET,
      },
      { status: 409 },
    );
  }

  // DB persistence check — survives redeploys and process restarts.
  try {
    const db = await getDb();
    const persisted = await db.getSyncState(faucetKey(address));
    if (persisted) {
      const claimedAt = parseInt(persisted, 10) || Date.now();
      // Populate in-memory cache so subsequent requests skip the DB.
      claimed.set(address, claimedAt);
      return NextResponse.json(
        {
          error: "already claimed",
          claimedAt: new Date(claimedAt).toISOString(),
          message: "Each address may claim once. Use the Circle faucet for more.",
          faucet: CIRCLE_FAUCET,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    // Fail open — a DB read error should not block legitimate first-time claimers.
    console.warn("[faucet] DB claim-check failed (fail-open):", err instanceof Error ? err.message : String(err));
  }

  if (!config.funderKey) return disabled("Faucet not configured (no funder wallet)");

  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });
  const recipient = session.address as `0x${string}`;

  const funderBalance = await publicClient.getBalance({ address: funder.address });
  if (funderBalance < DRIP + FUNDER_BUFFER) {
    return disabled("Funder balance too low — use Circle faucet");
  }

  // Mark claimed in-memory BEFORE sending so concurrent requests can't double-claim.
  const claimedAt = Date.now();
  claimed.set(address, claimedAt);

  try {
    const tx = await wallet.sendTransaction({ to: recipient, value: DRIP });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      throw new Error(`drip tx reverted (${tx})`);
    }

    // Persist the claim so it survives redeploys. Fire-and-forget — a write failure
    // does not roll back the on-chain transfer (money already sent). The in-memory
    // cache prevents a second drip within the same process lifetime.
    getDb()
      .then((db) => db.setSyncState(faucetKey(address), String(claimedAt)))
      .catch((err) =>
        console.error(
          "[faucet] failed to persist claim to DB (claim still valid in-memory):",
          err instanceof Error ? err.message : String(err),
        ),
      );

    return NextResponse.json({
      ok: true,
      tx,
      amount: formatEther(DRIP), // USDC (same value via native or ERC-20 view)
      explorer: config.explorerUrl,
      faucet: CIRCLE_FAUCET,
    });
  } catch (err) {
    // Roll back in-memory flag so the user can retry after a transient failure.
    // DB row was not written yet (write is post-success), so no DB rollback needed.
    claimed.delete(address);
    console.error("[faucet] drip failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "drip failed — try again or use Circle faucet", faucet: CIRCLE_FAUCET },
      { status: 500 },
    );
  }
}
