/**
 * registry-client.ts — viem read/write helpers for SourceRegistry.
 *
 * Exports:
 *   urlHash(url)        — keccak256(toBytes(canonicalUrl)) — the bytes32 passed to register()
 *   sourceId(creator, url) — keccak256(abi.encode(creator, urlHash)) — matches on-chain id derivation
 *   REGISTRY_ABI        — minimal ABI for the SourceRegistry contract
 *   getRegistrySource() — read a single record from the chain
 *   buildRegisterArgs() — encode calldata for the creator's wallet to sign+submit
 *   buildUpdateArgs()   — encode calldata for update tx
 *   buildDeactivateArgs()— encode calldata for deactivate tx
 *
 * All write calls are CREATOR-SIGNED: the creator's connected wallet (wagmi useWriteContract)
 * submits the tx and pays gas. This module only encodes the calls; it never holds a private key.
 *
 * ID derivation (matches contract):
 *   urlHash  = keccak256(toBytes(url))
 *   sourceId = keccak256(encodeAbiParameters([address, bytes32], [creator, urlHash]))
 * Binding the id to the creator address makes URL squatting impossible.
 */

import {
  createPublicClient,
  http,
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
  type Address,
} from "viem";
import { arcTestnet } from "@/lib/chains";
import { config } from "@/lib/config";

// ── ABI (minimal — only what the indexer + client need) ──────────────────────

export const REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "urlHash", type: "bytes32" },       // keccak256(toBytes(canonicalUrl))
      { name: "payoutWallet", type: "address" },
      {
        name: "authors",
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "basisPoints", type: "uint16" },
        ],
      },
      { name: "fetchPriceUsdc6", type: "uint64" },
      { name: "contentCid", type: "string" },
      { name: "tags", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "update",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "payoutWallet", type: "address" },
      {
        name: "authors",
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "basisPoints", type: "uint16" },
        ],
      },
      { name: "fetchPriceUsdc6", type: "uint64" },
      { name: "contentCid", type: "string" },
      { name: "tags", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "deactivate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "get",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "payoutWallet", type: "address" },
          {
            name: "authors",
            type: "tuple[]",
            components: [
              { name: "wallet", type: "address" },
              { name: "basisPoints", type: "uint16" },
            ],
          },
          { name: "fetchPriceUsdc6", type: "uint64" },
          { name: "contentCid", type: "string" },
          { name: "tags", type: "string" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "sourceCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "SourceRegistered",
    type: "event",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "contentCid", type: "string", indexed: false },
    ],
  },
  {
    name: "SourceUpdated",
    type: "event",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "updater", type: "address", indexed: true },
    ],
  },
  {
    name: "SourceDeactivated",
    type: "event",
    inputs: [{ name: "id", type: "bytes32", indexed: true }],
  },
] as const;

// ── Source ID helpers ─────────────────────────────────────────────────────────

/**
 * Returns keccak256(toBytes(canonicalUrl)) — the `urlHash` parameter passed to register().
 * This is NOT the full source id; it is the per-url component before creator-binding.
 */
export function urlHash(url: string): Hex {
  return keccak256(toBytes(url));
}

/**
 * Derives the on-chain bytes32 source ID from a creator address and canonical URL.
 * Matches the contract: id = keccak256(abi.encode(creator, urlHash)).
 *
 * The creator address is bound into the id, so different callers registering the
 * same URL get different IDs — URL squatting is impossible.
 *
 * Used by: POST /api/sources (server), register-form (client preview), indexer (verify).
 */
export function sourceId(creator: Address, url: string): Hex {
  const uh = urlHash(url);
  return keccak256(
    encodeAbiParameters(parseAbiParameters("address, bytes32"), [creator, uh]),
  );
}

// ── Public client (read-only, no key) ────────────────────────────────────────

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(config.rpcUrl),
  });
}

// ── On-chain read ─────────────────────────────────────────────────────────────

export type OnChainRecord = {
  creator: Address;
  payoutWallet: Address;
  authors: ReadonlyArray<{ wallet: Address; basisPoints: number }>;
  fetchPriceUsdc6: bigint;
  contentCid: string;
  tags: string;
  active: boolean;
};

/**
 * Reads a source record from the on-chain registry.
 * Returns null if the registry is not configured or the source doesn't exist.
 * Throws on RPC errors so the indexer can abort the chunk and retry (M3 fix).
 */
export async function getRegistrySource(id: Hex): Promise<OnChainRecord | null> {
  if (!config.registryAddress) return null;

  const client = getPublicClient();
  // Do NOT catch here — let RPC errors propagate so the indexer knows this chunk
  // failed and does not advance the checkpoint past unprocessed logs (M3).
  const record = await client.readContract({
    address: config.registryAddress as Address,
    abi: REGISTRY_ABI,
    functionName: "get",
    args: [id],
  });
  // Zero address creator means the record doesn't exist.
  if (record.creator === "0x0000000000000000000000000000000000000000") return null;
  return record as OnChainRecord;
}

// ── Write call encoders (for wagmi useWriteContract on the client) ────────────

export interface AuthorSplitInput {
  wallet: Address;
  basisPoints: number; // 1..10_000; all authors for one source must sum to 10_000
}

export interface RegistryCallParams {
  urlHash: Hex;       // keccak256(toBytes(canonicalUrl)) — NOT the full sourceId
  payoutWallet: Address;
  authors: AuthorSplitInput[];
  fetchPriceUsdc6: bigint; // USDC-6 atomic units (e.g. 100 = $0.0001)
  contentCid: string;
  tags: string;
}

/**
 * Returns the args needed for wagmi's useWriteContract to call registry.register().
 * Pass urlHash (not sourceId) — the contract derives the id on-chain from msg.sender + urlHash.
 * The creator's connected wallet signs and submits this — gas paid by the creator.
 */
export function buildRegisterArgs(p: RegistryCallParams) {
  return {
    address: config.registryAddress as Address,
    abi: REGISTRY_ABI,
    functionName: "register" as const,
    args: [
      p.urlHash,         // bytes32 urlHash — id derived on-chain
      p.payoutWallet,
      p.authors,
      p.fetchPriceUsdc6,
      p.contentCid,
      p.tags,
    ] as const,
  };
}

/**
 * Returns the args for wagmi's useWriteContract to call registry.update().
 * update() takes the full sourceId (already derived and stored).
 */
export interface UpdateCallParams {
  id: Hex;
  payoutWallet: Address;
  authors: AuthorSplitInput[];
  fetchPriceUsdc6: bigint;
  contentCid: string;
  tags: string;
}

export function buildUpdateArgs(p: UpdateCallParams) {
  return {
    address: config.registryAddress as Address,
    abi: REGISTRY_ABI,
    functionName: "update" as const,
    args: [
      p.id,
      p.payoutWallet,
      p.authors,
      p.fetchPriceUsdc6,
      p.contentCid,
      p.tags,
    ] as const,
  };
}

/**
 * Returns the args for wagmi's useWriteContract to call registry.deactivate().
 */
export function buildDeactivateArgs(id: Hex) {
  return {
    address: config.registryAddress as Address,
    abi: REGISTRY_ABI,
    functionName: "deactivate" as const,
    args: [id] as const,
  };
}
