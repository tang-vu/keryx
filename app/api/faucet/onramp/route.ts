/**
 * POST /api/faucet/onramp  { address }
 *
 * Unauthenticated, bounded testnet-USDC drip that lets a brand-new EXTERNAL caller (the Keryx MCP
 * buyer, a judge, any third-party agent) fund its own Arc-testnet wallet in one call — no Circle
 * faucet captcha, no SIWE sign-in. The caller then pays Keryx's x402 toll from THAT wallet, so the
 * call is still a genuine external on-chain payment (this only removes the funding friction).
 *
 * The sibling /api/faucet route is SIWE-gated (per-user, larger drip). This route is anonymous, so
 * it trades the SIWE gate for tighter bounds:
 *   1. Once per address — persisted in sync_state ("onramp:<address>"), survives restarts/redeploys.
 *   2. Global rate limit (RateLimiterMemory) — caps burst.
 *   3. Hard GLOBAL DAILY CAP (USDC) — bounds total drain regardless of address count; the funder
 *      holds only testnet USDC, so worst case is a few refillable test dollars per day.
 *   4. Funder-balance buffer check before sending.
 * Drip is small (one Gateway deposit + a handful of calls); top-ups beyond it use the Circle faucet.
 *
 * On Arc, USDC IS the native gas token, so a single native transfer credits a balance spendable both
 * as gas and via the ERC-20 / Gateway interface (same invariant the SIWE faucet relies on).
 */

import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseEther,
  formatEther,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const DRIP_USDC = Number(process.env.KERYX_ONRAMP_USDC ?? "0.7");
const DRIP = parseEther(String(DRIP_USDC)); // native USDC (18dp on Arc)
const DAILY_CAP_USDC = Number(process.env.KERYX_ONRAMP_DAILY_CAP ?? "20");
const FUNDER_BUFFER = parseEther("0.05"); // keep enough for the funder's own gas
const CIRCLE_FAUCET = "https://faucet.circle.com/";

// Shared bucket: max 5 onramp drips/min across all callers.
const limiter = new RateLimiterMemory({ points: 5, duration: 60, keyPrefix: "onramp" });

const addrKey = (a: string) => `onramp:${a}`;
const dayKey = () => `onramp-day:${new Date().toISOString().slice(0, 10)}`; // UTC day

function disabled(reason: string) {
  return NextResponse.json({ error: reason, faucet: CIRCLE_FAUCET }, { status: 503 });
}

export async function POST(req: Request) {
  let address: string;
  try {
    address = String((await req.json())?.address ?? "");
  } catch {
    return NextResponse.json({ error: "expected JSON body { address }" }, { status: 400 });
  }
  if (!isAddress(address)) {
    return NextResponse.json({ error: "invalid EVM address" }, { status: 400 });
  }
  const lower = address.toLowerCase();

  try {
    await limiter.consume("global");
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      return NextResponse.json(
        { error: "onramp busy — try again shortly", retryAfter, faucet: CIRCLE_FAUCET },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  if (!config.funderKey) return disabled("Onramp not configured (no funder wallet)");
  const db = await getDb();

  // 1. Once per address.
  try {
    const prior = await db.getSyncState(addrKey(lower));
    if (prior) {
      return NextResponse.json(
        {
          error: "already funded",
          message: "This address was already onramped once. Top up via the Circle faucet.",
          faucet: CIRCLE_FAUCET,
        },
        { status: 409 },
      );
    }
  } catch {
    // Fail closed on the once-per-address check would block legit callers on a transient DB error;
    // fail open is acceptable here because the global daily cap still bounds total drain.
  }

  // 2. Global daily cap — bounds total drain regardless of how many addresses ask.
  const dk = dayKey();
  let dayTotal = 0;
  try {
    dayTotal = parseFloat((await db.getSyncState(dk)) ?? "0") || 0;
  } catch {
    /* treat as 0 on read error */
  }
  if (dayTotal + DRIP_USDC > DAILY_CAP_USDC) {
    return disabled("Daily onramp cap reached — use the Circle faucet");
  }

  // 3. Funder buffer check.
  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });
  const funderBalance = await publicClient.getBalance({ address: funder.address });
  if (funderBalance < DRIP + FUNDER_BUFFER) {
    return disabled("Funder balance too low — use the Circle faucet");
  }

  try {
    const tx = await wallet.sendTransaction({ to: address as `0x${string}`, value: DRIP });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`drip tx reverted (${tx})`);

    // Persist the per-address claim + advance the daily total. Best-effort: the money is already
    // sent, so a write failure must not 500 the caller (the in-memory cap/limit still applies).
    db.setSyncState(addrKey(lower), String(Date.now())).catch(() => {});
    db.setSyncState(dk, String(dayTotal + DRIP_USDC)).catch(() => {});

    return NextResponse.json({
      ok: true,
      tx,
      amount: formatEther(DRIP),
      address,
      explorer: config.explorerUrl,
    });
  } catch (err) {
    console.error("[onramp] drip failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "drip failed — try again or use the Circle faucet", faucet: CIRCLE_FAUCET },
      { status: 500 },
    );
  }
}
