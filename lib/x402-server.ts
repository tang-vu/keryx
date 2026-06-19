/**
 * Keryx x402 seller helper. Wraps content behind a Circle Gateway batched payment:
 * returns 402 with payment requirements, then verifies + settles on retry and serves content.
 *
 * Unlike the scaffold's withGateway, this does NOT write to the DB — the agent records payments
 * with full context (queryId, rationale, weight). `payTo` is per-source (the creator's wallet),
 * so the toll/reward lands directly in the creator's wallet.
 */

import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { NextRequest, NextResponse } from "next/server";
import { config } from "./config";

const facilitator = new BatchFacilitatorClient();

export interface PaidOptions {
  priceUsdc: number;
  payTo: string;
  endpoint: string;
  description?: string;
}

function buildRequirements(priceUsdc: number, payTo: string) {
  const amount = Math.max(1, Math.round(priceUsdc * 1_000_000)); // atomic 6dp, min 1 unit
  return {
    scheme: "exact" as const,
    network: config.networkId,
    asset: config.usdcAddress,
    amount: amount.toString(),
    payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: config.gatewayWallet,
    },
  };
}

function b64(s: string): string {
  return Buffer.from(s).toString("base64");
}

/**
 * Build the x402 "402 Payment Required" challenge response for a paid endpoint.
 * The machine-readable challenge (x402 v2) rides in the PAYMENT-REQUIRED header; `body` is an
 * optional human-readable JSON payload (defaults to `{}` — the scaffold's empty-body convention).
 * Exposed so a discovery probe (e.g. the GET that `circle services inspect` issues) can advertise
 * the same price + schema as the paid POST, without running the handler or taking any payment.
 */
export function challengeResponse(opts: PaidOptions, body: unknown = {}): NextResponse {
  const requirements = buildRequirements(opts.priceUsdc, opts.payTo);
  const challenge = {
    x402Version: 2,
    resource: {
      url: opts.endpoint,
      description: opts.description ?? `Paid resource (${opts.priceUsdc} USDC)`,
      mimeType: "application/json",
    },
    accepts: [requirements],
  };
  return new NextResponse(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": b64(JSON.stringify(challenge)),
    },
  });
}

/**
 * Settle an x402 payment (if present) then produce the response body.
 * Returns a 402 challenge when no payment-signature header is present.
 */
export interface SettleInfo {
  payer: string;
  transaction: string;
  amountUsdc: number;
}

export async function settleThenServe(
  req: NextRequest,
  opts: PaidOptions,
  produce: (settle: SettleInfo) => Promise<unknown> | unknown,
): Promise<NextResponse> {
  const requirements = buildRequirements(opts.priceUsdc, opts.payTo);
  const sig = req.headers.get("payment-signature");

  if (!sig) {
    return challengeResponse(opts);
  }

  // Decode the base64 payment-signature header. Two buyer shapes reach here:
  //   • SDK buyer (volume engine, GatewayClient.pay) sends the FULL x402 PaymentPayload:
  //     { x402Version, resource, accepted, payload: { authorization, signature } }.
  //   • Browser co-sign sends only the INNER blob: { signature, authorization }.
  // Typed as any to match the SDK's PaymentPayload (same as the prior JSON.parse result).
  let decoded: any;
  try {
    decoded = JSON.parse(Buffer.from(sig, "base64").toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "invalid payment header" }, { status: 400 });
  }

  // Circle's facilitator requires the full PaymentPayload — it rejects the inner-only blob
  // with 400 "x402Version/resource/accepted/payload: Required". The SDK shape already has
  // `.payload`; the browser shape doesn't, so wrap it. `accepted` must equal the very
  // requirements the browser signed against — which is exactly what buildRequirements()
  // produced for this route's 402 challenge, so it always matches. `resource` is unsigned
  // metadata, so reconstructing it server-side is safe.
  const payload = decoded?.payload
    ? decoded
    : {
        x402Version: 2,
        resource: {
          url: opts.endpoint,
          description: opts.description ?? `Paid resource (${opts.priceUsdc} USDC)`,
          mimeType: "application/json",
        },
        accepted: requirements,
        payload: { authorization: decoded?.authorization, signature: decoded?.signature },
      };

  try {
    // Circle's facilitator occasionally throws a transient 4xx ("Circle Gateway verify
    // failed (400)…") on otherwise-valid payments (~5% on testnet). Retry the throwing
    // call a couple of times with a short backoff before giving up.
    // verify() is read-only — always safe to retry. settle() is retried only when it
    // THROWS (no confirmation received): the EIP-3009 nonce is consumed only by a
    // successful on-chain settle, so a transient throw leaves the nonce reusable.
    const verify = await withRetry(() => facilitator.verify(payload, requirements), "verify", opts.endpoint);
    if (!verify.isValid) {
      console.error(`[x402] verify FAILED ${opts.endpoint}: ${verify.invalidReason}`, JSON.stringify(requirements));
      return NextResponse.json({ error: "verification failed", reason: verify.invalidReason }, { status: 402 });
    }
    const settle = await withRetry(() => facilitator.settle(payload, requirements), "settle", opts.endpoint);
    if (!settle.success) {
      console.error(`[x402] settle FAILED ${opts.endpoint}: ${settle.errorReason}`);
      return NextResponse.json({ error: "settlement failed", reason: settle.errorReason }, { status: 402 });
    }
    console.log(`[x402] settled ${opts.endpoint}: ${settle.transaction}`);
    const body = await produce({
      payer: settle.payer ?? verify.payer ?? "unknown",
      transaction: settle.transaction ?? "",
      amountUsdc: opts.priceUsdc,
    });
    const res = NextResponse.json(body ?? { ok: true });
    res.headers.set(
      "PAYMENT-RESPONSE",
      b64(JSON.stringify({ success: true, transaction: settle.transaction, payer: settle.payer ?? verify.payer, network: requirements.network })),
    );
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "payment processing error", message }, { status: 500 });
  }
}

/** Retry an async facilitator call up to 2 attempts on a thrown transient error. */
async function withRetry<T>(fn: () => Promise<T>, label: string, endpoint: string): Promise<T> {
  const MAX_ATTEMPTS = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[x402] ${label} threw (attempt ${attempt}/${MAX_ATTEMPTS}) ${endpoint}: ${msg}`);
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}
