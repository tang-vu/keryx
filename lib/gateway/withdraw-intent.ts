"use client";

/**
 * Browser-side builder + signer for a Circle Gateway "burn intent" — the authorization a
 * creator signs to withdraw their accrued Gateway balance back on-chain as real USDC.
 *
 * Why this exists: @circle-fin/x402-batching's GatewayClient.withdraw() only works with a
 * raw privateKey and only against the key's OWN balance. A creator who connected their wallet
 * holds the key in the browser, so we replicate the SDK's withdraw signing here (verified
 * against dist/client/index.js:1030-1161) and let the connected wallet sign it. The signed
 * intent is relayed by POST /api/withdraw, where Circle returns a mint attestation and the
 * Keryx treasury submits the on-chain gatewayMint() — so the creator pays no gas.
 *
 * Non-custodial: the signature can only be produced by the balance owner (sourceDepositor),
 * so nobody can withdraw someone else's funds. destinationCaller = zeroAddress makes the mint
 * permissionless, which is exactly what lets the treasury submit it on the creator's behalf.
 *
 * The EIP-712 domain is { name, version } only — NO chainId/verifyingContract — so signing
 * needs no network switch and costs no gas.
 */

import {
  pad,
  getAddress,
  parseUnits,
  maxUint256,
  zeroAddress,
  type WalletClient,
  type Hex,
} from "viem";
import { config } from "@/lib/config";

/** TransferSpec + BurnIntent EIP-712 types, verbatim from the SDK (dist/client/index.js:1054-1080). */
const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

/** Wire-safe burn intent (all bigints serialised to decimal strings) sent to /api/withdraw. */
export interface WireBurnIntent {
  maxBlockHeight: string;
  maxFee: string;
  spec: {
    version: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: Hex;
    destinationContract: Hex;
    sourceToken: Hex;
    destinationToken: Hex;
    sourceDepositor: Hex;
    destinationRecipient: Hex;
    sourceSigner: Hex;
    destinationCaller: Hex;
    value: string;
    salt: Hex;
    hookData: Hex;
  };
}

export interface SignedWithdrawIntent {
  burnIntent: WireBurnIntent;
  signature: Hex;
}

/** Address → left-padded bytes32 (matches the SDK's addressToBytes32). */
function toBytes32(addr: string): Hex {
  return pad(addr.toLowerCase() as Hex, { size: 32 });
}

/** Cryptographically-random 32-byte salt as hex. */
function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/**
 * Build a same-chain (Arc → Arc) burn intent for `valueAtomic` USDC to `recipient`, signed by
 * the connected wallet. sourceDepositor/sourceSigner are the signer's own address — Circle only
 * mints against a balance the signer actually owns.
 *
 * @param walletClient - the connected creator wallet (wagmi useWalletClient)
 * @param valueAtomic  - amount to withdraw in atomic USDC units (6 decimals)
 * @param recipient    - address to receive the minted USDC (defaults to the signer)
 */
export async function buildAndSignWithdrawIntent(
  walletClient: WalletClient,
  valueAtomic: bigint,
  recipient?: string,
): Promise<SignedWithdrawIntent> {
  const account = walletClient.account;
  if (!account) throw new Error("wallet has no account");
  const from = getAddress(account.address);
  const to = getAddress(recipient ?? account.address);
  if (valueAtomic <= BigInt(0)) throw new Error("withdraw amount must be > 0");

  const domain = config.cctpDomain; // Arc testnet CCTP domain (same source + destination)
  const maxFee = parseUnits(config.withdrawMaxFeeUsdc.toFixed(6), 6);
  const salt = randomSalt();

  // Bigint form used for the EIP-712 hash (matches GatewayClient.createBurnIntent exactly).
  const spec = {
    version: 1,
    sourceDomain: domain,
    destinationDomain: domain,
    sourceContract: toBytes32(config.gatewayWallet),
    destinationContract: toBytes32(config.gatewayMinter),
    sourceToken: toBytes32(config.usdcAddress),
    destinationToken: toBytes32(config.usdcAddress),
    sourceDepositor: toBytes32(from),
    destinationRecipient: toBytes32(to),
    sourceSigner: toBytes32(from),
    destinationCaller: toBytes32(zeroAddress),
    value: valueAtomic,
    salt,
    hookData: "0x" as Hex,
  };
  const message = { maxBlockHeight: maxUint256, maxFee, spec };

  // domain = { name, version } only (no chainId) → chain-agnostic signature, no gas, no switch.
  // viem derives EIP712Domain([name, version]) from this domain, identical to the SDK.
  const signature = await walletClient.signTypedData({
    account,
    domain: { name: "GatewayWallet", version: "1" },
    types: BURN_INTENT_TYPES,
    primaryType: "BurnIntent",
    message,
  });

  // Serialise bigints → strings for JSON transport. Equal numeric values ⇒ Circle reconstructs
  // the same EIP-712 digest, so the signature still verifies (the SDK posts strings too).
  const burnIntent: WireBurnIntent = {
    maxBlockHeight: maxUint256.toString(),
    maxFee: maxFee.toString(),
    spec: { ...spec, value: valueAtomic.toString() },
  };

  return { burnIntent, signature };
}
