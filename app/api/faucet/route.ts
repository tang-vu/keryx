/**
 * POST /api/faucet
 *
 * Drips testnet USDC to the authenticated user's wallet — once per address.
 * Requires a valid SIWE session (keryx_session JWT cookie) so anonymous callers
 * can't drain the funder wallet.
 *
 * Drain protections:
 *   1. Per-address claim tracking (in-memory Map). Resets on process restart —
 *      acceptable for testnet: the faucet is rate-limited and low-value, and the
 *      funder wallet is purpose-funded with a small testnet balance.
 *   2. Global rate limit via RateLimiterMemory (reuses lib/rate-limit pattern but
 *      a dedicated limiter so faucet traffic doesn't consume ask-tier quota).
 *   3. Funder balance check before each drip — returns a clear error + Circle
 *      faucet link if funds are insufficient.
 *
 * Drip amounts (configurable via env, sensible defaults):
 *   KERYX_FAUCET_NATIVE  — native USDC for gas (18-decimal Arc native token). Default 0.1
 *   KERYX_FAUCET_DRIP_USDC — ERC-20 USDC for payments (6-decimal). Default 1
 *
 * Amounts must cover the grant/fund flow in use-session-grant.ts:
 *   - USDC ERC-20 transfer to session EOA         (~0.001 USDC gas at Arc prices)
 *   - ERC-20 approve + Gateway deposit from EOA   (~0.002 USDC gas)
 *   0.1 native USDC covers ~5 grant cycles at current Arc testnet gas prices.
 */

import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { getSession } from "@/lib/auth";
import { config } from "@/lib/config";

export const runtime = "nodejs";

// ── Config ────────────────────────────────────────────────────────────────────

const NATIVE_DRIP = parseEther(process.env.KERYX_FAUCET_NATIVE ?? "0.1");
const ERC20_DRIP = parseUnits(process.env.KERYX_FAUCET_DRIP_USDC ?? "1", 6);
const CIRCLE_FAUCET = "https://faucet.circle.com/";

// ── Drain protection ─────────────────────────────────────────────────────────

// Tracks addresses that have already claimed. In-memory is sufficient for testnet:
// single-process VPS, low-value drips, resets on deploy (acceptable for testnet faucet).
const claimed = new Map<string, number>(); // address → timestamp ms

// Global rate limit: max 5 drip requests per minute across all callers.
// Keyed by the constant "global" so all requests share the same bucket.
const globalLimiter = new RateLimiterMemory({ points: 5, duration: 60, keyPrefix: "faucet" });

// ── Helpers ───────────────────────────────────────────────────────────────────

function faucetDisabledResponse(reason: string) {
  return NextResponse.json(
    { error: reason, faucet: CIRCLE_FAUCET },
    { status: 503 },
  );
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST() {
  // 1. SIWE gate — must be authenticated to prevent anonymous drain.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const address = session.address.toLowerCase();

  // 2. Global rate limit — all drip requests share this bucket.
  try {
    await globalLimiter.consume("global");
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      return NextResponse.json(
        { error: "faucet busy — try again shortly", retryAfter: Math.ceil(err.msBeforeNext / 1000), faucet: CIRCLE_FAUCET },
        { status: 429, headers: { "Retry-After": String(Math.ceil(err.msBeforeNext / 1000)) } },
      );
    }
    // Fail open on unexpected limiter error.
  }

  // 3. Per-address claim guard — one drip per wallet per process lifetime.
  if (claimed.has(address)) {
    const claimedAt = new Date(claimed.get(address)!).toISOString();
    return NextResponse.json(
      {
        error: "already claimed",
        claimedAt,
        message: "Each address may claim once. Use the Circle faucet for more.",
        faucet: CIRCLE_FAUCET,
      },
      { status: 409 },
    );
  }

  // 4. Funder wallet must be configured.
  if (!config.funderKey) {
    return faucetDisabledResponse("Faucet not configured (no funder wallet)");
  }

  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  const funderWallet = createWalletClient({
    account: funder,
    chain: arcTestnet,
    transport: http(config.rpcUrl),
  });

  const recipient = session.address as `0x${string}`;

  // 5. Check funder has enough native balance for gas drip + its own tx fees.
  const nativeBalance = await publicClient.getBalance({ address: funder.address });
  // Require at least NATIVE_DRIP + 0.05 native USDC buffer for the funder's own gas.
  const nativeBuffer = parseEther("0.05");
  if (nativeBalance < NATIVE_DRIP + nativeBuffer) {
    return faucetDisabledResponse("Funder native balance too low — use Circle faucet");
  }

  // 6. Check funder has enough ERC-20 USDC.
  const erc20Balance = await publicClient.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [funder.address],
  });
  if (erc20Balance < ERC20_DRIP) {
    return faucetDisabledResponse("Funder ERC-20 USDC balance too low — use Circle faucet");
  }

  // 7. Mark as claimed BEFORE sending to prevent double-claim from concurrent requests.
  claimed.set(address, Date.now());

  try {
    // 8a. Send native USDC (Arc gas token, 18 decimals) to recipient.
    const nativeTx = await funderWallet.sendTransaction({
      to: recipient,
      value: NATIVE_DRIP,
    });
    await publicClient.waitForTransactionReceipt({ hash: nativeTx });

    // 8b. Transfer ERC-20 USDC (6 decimals) to recipient.
    const erc20Tx = await funderWallet.writeContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, ERC20_DRIP],
    });
    await publicClient.waitForTransactionReceipt({ hash: erc20Tx });

    return NextResponse.json({
      ok: true,
      nativeTx,
      erc20Tx,
      nativeAmount: (Number(NATIVE_DRIP) / 1e18).toFixed(2),
      erc20Amount: (Number(ERC20_DRIP) / 1e6).toFixed(2),
      explorer: config.explorerUrl,
      faucet: CIRCLE_FAUCET,
    });
  } catch (err) {
    // Rollback the claimed marker so the user can retry after a transient error.
    claimed.delete(address);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[faucet] drip failed:", message);
    return NextResponse.json(
      { error: "drip failed — try again or use Circle faucet", faucet: CIRCLE_FAUCET },
      { status: 500 },
    );
  }
}
