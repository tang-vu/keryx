"use client";

/**
 * Browser-side EIP-712 payment header builder for x402 co-sign flow.
 *
 * Produces the base64 `{signature, authorization}` inner blob that
 * lib/x402-server.ts decodes, wraps into the full x402 PaymentPayload
 * ({ x402Version, resource, accepted, payload }), and passes to BatchFacilitatorClient.
 *
 * The Arc testnet EIP-712 domain is pinned in this browser module, separately
 * from the SSE challenge. Types mirror the installed Circle batching SDK.
 *
 * The challenge's validity window is accepted only within the browser policy.
 *
 * The caller separately verifies source authority and the grant cap.
 */

import { isAddress, type WalletClient } from "viem";

// Independent browser policy for the current Arc testnet deployment.
const ARC_NETWORK = "eip155:5042002";
const ARC_CHAIN_ID = 5042002;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_GATEWAY = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const MIN_TIMEOUT_SECONDS = 604900;
const MAX_TIMEOUT_SECONDS = 691200;

export interface PaymentRequirementsInput {
  scheme: string;
  network: string;           // e.g. "eip155:5042002"
  asset: string;
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
/** Legacy headless caller: keeps the established two-argument API. It uses the
 * same pinned chain and domain policy, but has no browser grant snapshot to compare. */
export async function signPaymentAuthorization(
  walletClient: WalletClient,
  requirements: PaymentRequirementsInput,
): Promise<SignedPaymentHeader> {
  const signer = walletClient.account?.address ?? "";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = "0x" + Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
  return signBrowserPaymentAuthorization(walletClient, requirements, signer, signer, nonce);
}

/** Browser entry point: both signer expectations must be supplied independently. */
export async function signBrowserPaymentAuthorization(
  walletClient: WalletClient,
  requirements: PaymentRequirementsInput,
  intendedSessionSigner: string,
  capturedGrantSigner: string,
  admittedNonce: string,
): Promise<SignedPaymentHeader> {
  const { scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra } = requirements;

  // Validate inputs before signing — defence against a compromised/MITM server.
  if (scheme !== "exact" || network !== ARC_NETWORK ||
      typeof asset !== "string" || asset.toLowerCase() !== ARC_USDC.toLowerCase()) {
    throw new Error("unsupported browser payment scheme, network, or asset");
  }
  if (!isAddress(payTo) || /^0x0{40}$/i.test(payTo)) {
    throw new Error("invalid payTo address in payment requirements");
  }
  if (typeof amount !== "string" || !/^[1-9]\d*$/.test(amount)) {
    throw new Error("invalid payment amount");
  }
  const amountBig = BigInt(amount);
  if (!Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds < MIN_TIMEOUT_SECONDS ||
      maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error("unsupported payment authorization lifetime");
  }
  if (extra?.name !== "GatewayWalletBatched" || extra.version !== "1" ||
      !isAddress(extra.verifyingContract) ||
      extra.verifyingContract.toLowerCase() !== ARC_GATEWAY.toLowerCase()) {
    throw new Error("unsupported Gateway signing domain");
  }

  const now = Math.floor(Date.now() / 1000);
  // validAfter 600s in the past to absorb clock skew between signer and verifier.
  const validAfter = BigInt(now - 600);
  // validBefore must leave ≥ 604800s (7d) remaining at verify time; use maxTimeoutSeconds
  // from the challenge (server sets it to ~8d = 691200s for margin).
  const validBefore = BigInt(now + maxTimeoutSeconds);

  // The server admitted this single-use nonce before exposure. Browser signing never
  // substitutes a random nonce; the separate legacy headless entry point owns its nonce.
  if (typeof admittedNonce !== "string" || !/^0x[0-9a-f]{64}$/.test(admittedNonce)) {
    throw new Error("missing or invalid admitted browser authorization nonce");
  }
  const nonce = admittedNonce as `0x${string}`;

  const account = walletClient.account;
  if (!account || !isAddress(intendedSessionSigner) || !isAddress(capturedGrantSigner) ||
      account.address.toLowerCase() !== intendedSessionSigner.toLowerCase() ||
      account.address.toLowerCase() !== capturedGrantSigner.toLowerCase()) {
    throw new Error("session signer does not match the local and captured grants");
  }
  const from = account.address;

  // The challenge must match these values, but never supplies the values we sign.
  const domain = {
    name: "GatewayWalletBatched",
    version: "1",
    chainId: ARC_CHAIN_ID,
    verifyingContract: ARC_GATEWAY as `0x${string}`,
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
