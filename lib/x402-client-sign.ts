"use client";

/**
 * Browser-side EIP-712 payment header builder for x402 co-sign flow.
 *
 * Produces the base64 `{signature, authorization}` inner blob that
 * lib/x402-server.ts decodes, wraps into the full x402 PaymentPayload
 * ({ x402Version, resource, accepted, payload }), and passes to BatchFacilitatorClient.
 *
 * Domain and types mirror what the SDK builds in GatewayClient.pay():
 *   - name "GatewayWalletBatched", version "1"
 *   - verifyingContract from the source's 402 PAYMENT-REQUIRED challenge
 *   - TransferWithAuthorization as per EIP-3009
 *
 * validBefore uses requirements.maxTimeoutSeconds (sourced from the server's
 * 402 challenge). Circle's Gateway facilitator requires remaining validity
 * ≥ 604800s (7 days) at verify time — use config.maxTimeoutSeconds (~8d) as
 * the window so there's margin for signing → network → verify latency.
 *
 * Client-side security validation:
 *   - `payTo` must be a non-empty hex address
 *   - `amount` must be > 0 and ≤ remaining grant cap (checked by caller)
 *   - `reqId` is passed straight through for the server's promise resolution
 */

import { type WalletClient } from "viem";

export interface PaymentRequirementsInput {
  network: string;           // e.g. "eip155:5042002"
  amount: string;            // atomic USDC (6 decimals), e.g. "2000"
  payTo: string;             // creator wallet address (0x…)
  maxTimeoutSeconds: number; // from the 402 challenge
  extra: {
    name: string;            // "GatewayWalletBatched"
    version: string;         // "1"
    verifyingContract: string; // GatewayWallet address
  };
}

export interface SignedPaymentHeader {
  /** Base64-encoded JSON `{signature, authorization}` — ready for the payment-signature header. */
  header: string;
  /** The raw authorization fields for the server's pending-promise payload. */
  authorization: AuthorizationFields;
}

interface AuthorizationFields {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * Build and sign an EIP-712 TransferWithAuthorization for the given payment
 * requirements, using the provided viem WalletClient (which holds the session key).
 *
 * Throws if requirements are malformed or signing fails.
 */
export async function signPaymentAuthorization(
  walletClient: WalletClient,
  requirements: PaymentRequirementsInput,
): Promise<SignedPaymentHeader> {
  const { network, amount, payTo, maxTimeoutSeconds, extra } = requirements;

  // Validate inputs before signing — defence against a compromised/MITM server.
  if (!payTo || !payTo.startsWith("0x") || payTo.length < 40) {
    throw new Error("invalid payTo address in payment requirements");
  }
  const amountBig = BigInt(amount);
  if (amountBig <= BigInt(0)) {
    throw new Error("invalid payment amount (must be > 0)");
  }
  if (!extra?.verifyingContract || !extra.verifyingContract.startsWith("0x")) {
    throw new Error("missing or invalid verifyingContract in 402 challenge");
  }

  // Extract chainId from the network identifier (e.g. "eip155:5042002" → 5042002).
  const chainId = parseInt(network.split(":")[1] ?? "0", 10);
  if (!chainId) throw new Error(`unrecognised network: ${network}`);

  const now = Math.floor(Date.now() / 1000);
  // validAfter 600s in the past to absorb clock skew between signer and verifier.
  const validAfter = BigInt(now - 600);
  // validBefore must leave ≥ 604800s (7d) remaining at verify time; use maxTimeoutSeconds
  // from the challenge (server sets it to ~8d = 691200s for margin).
  const validBefore = BigInt(now + maxTimeoutSeconds);

  // Random 32-byte nonce — single-use, regenerated per signature (EIP-3009 nonces
  // are single-use on-chain; the facilitator rejects replays).
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = ("0x" + Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;

  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account");
  const from = account.address;

  // EIP-712 domain mirrors the SDK: name + version from 402 extra, chainId from network,
  // verifyingContract from 402 extra. Must match exactly for Circle's facilitator to verify.
  const domain = {
    name: extra.name,       // "GatewayWalletBatched"
    version: extra.version, // "1"
    chainId,
    verifyingContract: extra.verifyingContract as `0x${string}`,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from",        type: "address" },
      { name: "to",          type: "address" },
      { name: "value",       type: "uint256" },
      { name: "validAfter",  type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce",       type: "bytes32" },
    ],
  } as const;

  const message = {
    from,
    to: payTo as `0x${string}`,
    value: amountBig,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await walletClient.signTypedData({
    account,
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  // Serialize authorization fields as decimal strings so they survive JSON round-trips
  // without BigInt serialisation errors (JSON.stringify doesn't support BigInt natively).
  const authorization: AuthorizationFields = {
    from,
    to: payTo,
    value: amountBig.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
  };

  // The server decodes: JSON.parse(Buffer.from(sig, "base64").toString("utf-8"))
  // and passes { signature, authorization } to BatchFacilitatorClient.verify/settle.
  const payload = { signature, authorization };
  const header = btoa(JSON.stringify(payload));

  return { header, authorization };
}
