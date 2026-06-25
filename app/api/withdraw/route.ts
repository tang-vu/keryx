/**
 * POST /api/withdraw — creator cash-out relay.
 *
 * The creator signs a Circle Gateway burn intent in the browser (lib/gateway/withdraw-intent.ts)
 * with their connected wallet. This route relays it to Circle's /transfer endpoint to get a mint
 * attestation, then has the Keryx TREASURY submit the on-chain gatewayMint() — so the creator pays
 * NO gas. Non-custodial: the burn-intent signature can only be produced by the balance owner, and
 * the burn intent's destinationCaller = zeroAddress makes the mint permissionless (any sender,
 * here the treasury, can submit it). The minted USDC lands in the creator's own wallet.
 *
 * The resulting EVM mint tx hash is recorded as a creator cash-out — it resolves at the explorer
 * /tx/, unlike the per-payment Circle settlement UUIDs.
 */

import { NextRequest } from "next/server";
import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "@/lib/config";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { WireBurnIntent } from "@/lib/gateway/withdraw-intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Circle Gateway testnet API. Mainnet is behind a config flag and out of scope for the demo path.
const GATEWAY_TRANSFER_API = "https://gateway-api-testnet.circle.com/v1/transfer";

/** gatewayMint(bytes attestationPayload, bytes signature) — from the SDK's GATEWAY_MINTER_ABI. */
const GATEWAY_MINTER_ABI = [
  {
    name: "gatewayMint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Decode a left-padded bytes32 back to a checksummed address (rightmost 20 bytes). */
function b32ToAddress(b32: string): string {
  return getAddress(("0x" + b32.slice(-40)) as Hex);
}

interface WithdrawBody {
  burnIntent: WireBurnIntent;
  signature: Hex;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!config.funderKey) {
    return Response.json({ error: "withdraw relay not configured" }, { status: 503 });
  }

  let body: WithdrawBody;
  try {
    body = (await req.json()) as WithdrawBody;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { burnIntent, signature } = body ?? {};
  const spec = burnIntent?.spec;
  if (!spec || !signature || typeof signature !== "string") {
    return Response.json({ error: "missing burnIntent or signature" }, { status: 400 });
  }

  // ── Validate the intent against this caller + this chain before spending treasury gas ──
  let depositor: string, signer: string, recipient: string;
  try {
    depositor = b32ToAddress(spec.sourceDepositor);
    signer = b32ToAddress(spec.sourceSigner);
    recipient = b32ToAddress(spec.destinationRecipient);
  } catch {
    return Response.json({ error: "malformed intent addresses" }, { status: 400 });
  }

  // The withdrawal must be for the signed-in wallet's own balance (correct attribution + no
  // free use of the treasury relay by non-owners).
  if (depositor.toLowerCase() !== session.address.toLowerCase() || signer.toLowerCase() !== depositor.toLowerCase()) {
    return Response.json({ error: "intent depositor does not match session" }, { status: 403 });
  }
  // Same-chain Arc→Arc only, against the canonical Gateway contracts + USDC.
  const okChain =
    spec.sourceDomain === config.cctpDomain &&
    spec.destinationDomain === config.cctpDomain &&
    b32ToAddress(spec.sourceContract).toLowerCase() === config.gatewayWallet.toLowerCase() &&
    b32ToAddress(spec.destinationContract).toLowerCase() === config.gatewayMinter.toLowerCase() &&
    b32ToAddress(spec.sourceToken).toLowerCase() === config.usdcAddress.toLowerCase() &&
    b32ToAddress(spec.destinationToken).toLowerCase() === config.usdcAddress.toLowerCase();
  if (!okChain) {
    return Response.json({ error: "intent targets an unexpected chain/contract" }, { status: 400 });
  }
  const valueAtomic = BigInt(spec.value);
  if (valueAtomic <= BigInt(0)) {
    return Response.json({ error: "withdraw amount must be > 0" }, { status: 400 });
  }
  const amountUsdc = Number(valueAtomic) / 1e6;

  try {
    // 1) Relay the signed burn intent to Circle → mint attestation.
    const transferRes = await fetch(GATEWAY_TRANSFER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ burnIntent, signature }]),
    });
    const result = (await transferRes.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      message?: string;
      attestation?: Hex;
      signature?: Hex;
    };
    if (result.success === false || result.error || !result.attestation || !result.signature) {
      const reason = result.message || result.error || `HTTP ${transferRes.status}`;
      console.error(`[withdraw] Circle /transfer failed: ${reason}`);
      return Response.json({ error: `gateway transfer failed: ${reason}` }, { status: 502 });
    }

    // 2) Treasury submits the on-chain mint (pays gas). destinationCaller = 0x0 ⇒ permissionless,
    //    so a sender other than the depositor is accepted.
    const funder = privateKeyToAccount(config.funderKey as Hex);
    const walletClient = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });
    const publicClient = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });

    const mintTxHash = await walletClient.writeContract({
      address: config.gatewayMinter,
      abi: GATEWAY_MINTER_ABI,
      functionName: "gatewayMint",
      args: [result.attestation, result.signature],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: mintTxHash, timeout: 90_000 });
    if (receipt.status !== "success") {
      return Response.json({ error: "mint reverted on-chain" }, { status: 502 });
    }

    // 3) Record the cash-out (best-effort — the on-chain mint already settled).
    try {
      const db = await getDb();
      const sources = await db.listSources();
      const match = sources.find((s) => s.walletAddress.toLowerCase() === recipient.toLowerCase());
      await db.recordWithdrawal({
        txHash: mintTxHash,
        label: match?.name ?? recipient,
        sourceName: match?.name,
        wallet: depositor,
        recipient,
        amountUsdc,
        network: config.network,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[withdraw] could not record cash-out: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log(`[withdraw] minted $${amountUsdc} → ${recipient} · tx ${mintTxHash}`);
    return Response.json({
      mintTxHash,
      amountUsdc,
      recipient,
      explorerUrl: `${config.explorerUrl}/tx/${mintTxHash}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[withdraw] error: ${message}`);
    return Response.json({ error: "withdraw failed", message }, { status: 500 });
  }
}
