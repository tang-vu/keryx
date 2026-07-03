/**
 * testmint-topup.mts — buy testnet USDC for the Keryx treasury from TestMint
 * (testmint.myproceeds.xyz, a Lepton partner faucet) over the x402 v2 protocol.
 *
 * ⚠️  THIS SPENDS REAL MONEY. TestMint charges mainnet USDC on Base (eip155:8453):
 *     1 mainnet USDC → 1,000 testnet USDC · 5 → 5,000 · 10 → 10,000 (arc-testnet).
 * The payment is an EIP-3009 signature (no gas needed), settled by TestMint's
 * facilitator. Without --yes-mainnet the script only dry-runs: it probes the 402,
 * prints the decoded payment terms, and exits without signing anything.
 *
 * Run:  npm run testmint -- --tier 1 [--recipient 0x…] --yes-mainnet
 * Env:  TESTMINT_PAYER_PRIVATE_KEY — wallet holding ≥ tier USDC on Base MAINNET.
 *       (Defaults recipient to the treasury/funder wallet on Arc testnet.)
 */

import { createPublicClient, erc20Abi, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { config } from "../lib/config.ts";

const API = "https://testmint.myproceeds.xyz";
const TIERS = new Set([1, 5, 10]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function decodeTerms(header: string | null): unknown {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Follow /api/tx-stream (SSE) until the delivery tx hash arrives. */
async function waitForDeliveryTx(token: string, timeoutMs = 180_000): Promise<string | null> {
  const res = await fetch(`${API}/api/tx-stream?token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return null;
    buf += dec.decode(value, { stream: true });
    // SSE frames: look for the tx-hash event's data line.
    const m = buf.match(/event:\s*tx-hash\s*\ndata:\s*(.+)/);
    if (m) {
      try {
        const d = JSON.parse(m[1]) as { txHash?: string; hash?: string };
        return d.txHash ?? d.hash ?? m[1].trim();
      } catch {
        return m[1].trim();
      }
    }
  }
}

async function main(): Promise<void> {
  const tier = parseInt(arg("tier") ?? "1", 10);
  if (!TIERS.has(tier)) throw new Error(`--tier must be 1, 5, or 10 (got ${arg("tier")})`);

  const recipient =
    arg("recipient") ??
    (config.funderKey ? privateKeyToAccount(config.funderKey as `0x${string}`).address : undefined);
  if (!recipient) throw new Error("No recipient: pass --recipient 0x… or set the funder key");

  const body = JSON.stringify({
    recipientAddress: recipient,
    destinationChain: "arc-testnet",
    mainnetAmount: tier,
    paymentChainId: base.id,
  });
  console.log(`[testmint] tier ${tier} USDC (Base mainnet) → ${tier * 1000} testnet USDC → ${recipient} (arc-testnet)`);

  if (!process.argv.includes("--yes-mainnet")) {
    // Dry run: probe the 402 and show exactly what a real run would pay.
    const probe = await fetch(`${API}/api/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    console.log(`[testmint] DRY RUN (no --yes-mainnet). Probe status: ${probe.status}`);
    console.log(JSON.stringify(decodeTerms(probe.headers.get("Payment-Required")), null, 2));
    console.log("[testmint] re-run with --yes-mainnet to actually pay mainnet USDC.");
    return;
  }

  const payerKey = process.env.TESTMINT_PAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!payerKey) throw new Error("TESTMINT_PAYER_PRIVATE_KEY not set (Base mainnet wallet with USDC)");
  const payer = privateKeyToAccount(payerKey);
  const basePublic = createPublicClient({ chain: base, transport: http() });

  // Sanity: the payer must actually hold the mainnet USDC before we sign anything.
  const terms = decodeTerms(
    (await fetch(`${API}/api/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body }))
      .headers.get("Payment-Required"),
  ) as { accepts?: { asset: `0x${string}`; amount: string; network: string }[] } | null;
  const accept = terms?.accepts?.[0];
  if (!accept) throw new Error("TestMint did not return x402 payment terms");
  const balance = await basePublic.readContract({
    address: accept.asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [payer.address],
  });
  if (balance < BigInt(accept.amount)) {
    throw new Error(
      `Payer ${payer.address} holds ${Number(balance) / 1e6} USDC on Base — needs ${Number(accept.amount) / 1e6}`,
    );
  }
  console.log(`[testmint] paying ${Number(accept.amount) / 1e6} USDC on ${accept.network} from ${payer.address}`);

  const client = new x402Client().register(
    "eip155:8453",
    new ExactEvmScheme(toClientEvmSigner(payer, basePublic)),
  );
  const payFetch = wrapFetchWithPayment(fetch, client);
  const res = await payFetch(`${API}/api/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = (await res.json()) as { deliveryToken?: string; [k: string]: unknown };
  if (!res.ok) throw new Error(`TestMint transfer failed (${res.status}): ${JSON.stringify(json)}`);
  console.log("[testmint] paid. response:", JSON.stringify(json));

  if (json.deliveryToken) {
    console.log("[testmint] waiting for delivery tx on Arc testnet…");
    const tx = await waitForDeliveryTx(json.deliveryToken);
    if (tx) console.log(`[testmint] delivered: https://testnet.arcscan.app/tx/${tx}`);
    else console.log("[testmint] no tx event received — check the recipient balance manually.");
  }

  // Confirm the testnet USDC actually landed (ERC-20 USDC on Arc, 6 decimals).
  const arcPublic = createPublicClient({ transport: http(config.rpcUrl) });
  const got = await arcPublic.readContract({
    address: config.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [recipient as `0x${string}`],
  });
  console.log(`[testmint] recipient now holds ${Number(got) / 1e6} USDC on Arc testnet.`);
}

main().catch((err) => {
  console.error("[testmint] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
