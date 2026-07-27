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
 *   2. Global rate limit (durable counter) — caps burst.
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
import { consumePoint } from "@/lib/rate-limit-store";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const DRIP_USDC = Number(process.env.KERYX_ONRAMP_USDC ?? "0.7");
const DRIP = parseEther(String(DRIP_USDC)); // native USDC (18dp on Arc)
const DAILY_CAP_USDC = Number(process.env.KERYX_ONRAMP_DAILY_CAP ?? "20");
const FUNDER_BUFFER = parseEther("0.05"); // keep enough for the funder's own gas
const CIRCLE_FAUCET = "https://faucet.circle.com/";

// Shared bucket: max 5 onramp drips/min across all callers. Durable, so the valve on the funder
// wallet does not reopen on every deploy.
const ONRAMP_POINTS = 5;
const ONRAMP_WINDOW_MS = 60_000;

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

  const drip = await consumePoint("global", "onramp", ONRAMP_POINTS, ONRAMP_WINDOW_MS);
  if (!drip.allowed) {
    const retryAfter = Math.max(1, Math.ceil(drip.msBeforeNext / 1000));
    return NextResponse.json(
      { error: "onramp busy — try again shortly", retryAfter, faucet: CIRCLE_FAUCET },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  if (!config.funderKey) return disabled("Onramp not configured (no funder wallet)");
  const db = await getDb();

  const dk = dayKey();
  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  const wallet = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });
  const funderBalance = await publicClient.getBalance({ address: funder.address });
  if (funderBalance < DRIP + FUNDER_BUFFER) {
    return disabled("Funder balance too low — use the Circle faucet");
  }

  // Final authority: reserve the address claim and daily amount in one DB transaction.
  let reservation: Awaited<ReturnType<typeof db.reserveOnramp>>;
  try {
    reservation = await db.reserveOnramp(
      addrKey(lower),
      dk,
      DRIP_USDC,
      DAILY_CAP_USDC,
      Date.now(),
    );
  } catch (err) {
    console.error("[onramp] reservation failed:", err);
    return disabled("Onramp accounting unavailable — try again shortly");
  }
  if (reservation === "already-funded") {
    return NextResponse.json(
      {
        error: "already funded",
        message: "This address was already onramped once. Top up via the Circle faucet.",
        faucet: CIRCLE_FAUCET,
      },
      { status: 409 },
    );
  }
  if (reservation === "daily-cap") {
    return disabled("Daily onramp cap reached — use the Circle faucet");
  }

  try {
    const tx = await wallet.sendTransaction({ to: address as `0x${string}`, value: DRIP });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`drip tx reverted (${tx})`);

    return NextResponse.json({
      ok: true,
      tx,
      amount: formatEther(DRIP),
      address,
      explorer: config.explorerUrl,
    });
  } catch (err) {
    await db.releaseOnramp(addrKey(lower), dk, DRIP_USDC).catch((releaseErr) => {
      console.error("[onramp] failed to release reservation:", releaseErr);
    });
    console.error("[onramp] drip failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "drip failed — try again or use the Circle faucet", faucet: CIRCLE_FAUCET },
      { status: 500 },
    );
  }
}
