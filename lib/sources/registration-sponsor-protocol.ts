import { z } from "zod";
import { encodeAbiParameters, hashTypedData, keccak256, toBytes, type Address, type Hex } from "viem";
import { canonicalJson } from "../canonical-json";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(value => !/^0x0{40}$/i.test(value)).transform(value => value.toLowerCase() as Address);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase() as Hex);
const uint = z.string().regex(/^(0|[1-9]\d{0,77})$/).refine(value => BigInt(value) < BigInt(2) ** BigInt(256));
const positive = uint.refine(value => BigInt(value) > BigInt(0));
export const registrationSponsorPolicySchema = z.object({
  protocol: z.literal("keryx-registration-sponsor-v1"),
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  deploymentOrigin: z.string().url().refine(value => new URL(value).origin === value),
  registryAddress: address, registryCodeHash: hash, sponsorAddress: address,
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxTransactionWei: positive, maxDailyWei: positive, maxLifetimeWei: positive,
  maxGas: z.number().int().min(21000).max(1_000_000),
  maxFeePerGasWei: positive.refine(value => BigInt(value) >= BigInt(20_000_000_000)),
  maxRegistrationsPerWallet: z.number().int().min(1).max(100),
  maxRegistrationsPerDay: z.number().int().min(1).max(1000),
  maxRegistrationsTotal: z.number().int().min(1).max(1000),
  allowlistedCreators: z.array(address).min(1).max(1000),
}).strict().refine(p => BigInt(p.maxTransactionWei) <= BigInt(p.maxDailyWei) &&
  BigInt(p.maxDailyWei) <= BigInt(p.maxLifetimeWei) &&
  BigInt(p.maxGas) * BigInt(p.maxFeePerGasWei) <= BigInt(p.maxTransactionWei), "Gas liability exceeds policy");
export type RegistrationSponsorPolicy = z.infer<typeof registrationSponsorPolicySchema>;
export const registrationParamsSchema = z.object({
  urlHash: hash, payoutWallet: address,
  authors: z.array(z.object({ wallet: address, basisPoints: z.number().int().min(1).max(10000) }).strict()).min(1).max(20),
  fetchPriceUsdc6: uint.refine(value => BigInt(value) < BigInt(2) ** BigInt(64)),
  contentCid: z.string().refine(value => new TextEncoder().encode(value).length <= 128),
  tags: z.string().refine(value => new TextEncoder().encode(value).length <= 256),
}).strict().refine(value => value.authors.reduce((sum, item) => sum + item.basisPoints, 0) === 10000, "Invalid author split");
export type RegistrationParams = z.infer<typeof registrationParamsSchema>;
export const sponsoredRegistrationSchema = z.object({
  id: hash, policyDigest: hash, creator: address, canonicalUrl: z.string().url().max(2048), rssUrl: z.string().url().max(2048),
  replacesRequestId: hash.optional(),
  claimId: z.string().regex(/^[a-f0-9]{64}$/), claimRevision: z.number().int().positive(),
  sourceId: z.string().min(1).max(256), onchainId: hash,
  registryAddress: address, registryCodeHash: hash, relayer: address, chainId: z.union([z.literal(5042), z.literal(5042002)]),
  params: registrationParamsSchema, nonce: uint, deadline: z.number().int().positive(),
  createdAt: z.number().int().positive(), updatedAt: z.number().int().positive(),
  reservedWei: positive,
  state: z.enum(["prepared", "signing", "submitted", "confirmed", "reverted", "expired"]),
  transactionHash: hash.optional(), transactionNonce: z.number().int().nonnegative().optional(),
  actualGasWei: uint.optional(),
}).strict();
export type SponsoredRegistration = z.infer<typeof sponsoredRegistrationSchema>;
export const REGISTRATION_TYPES = { Registration: [
  { name: "creator", type: "address" }, { name: "relayer", type: "address" },
  { name: "urlHash", type: "bytes32" }, { name: "payoutWallet", type: "address" },
  { name: "authorsHash", type: "bytes32" }, { name: "fetchPriceUsdc6", type: "uint64" },
  { name: "contentCidHash", type: "bytes32" }, { name: "tagsHash", type: "bytes32" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint64" },
] } as const;
export function registrationTypedData(row: SponsoredRegistration) {
  return { domain: { name: "KeryxSourceRegistry", version: "3", chainId: row.chainId, verifyingContract: row.registryAddress },
    types: REGISTRATION_TYPES, primaryType: "Registration" as const, message: {
      creator: row.creator, relayer: row.relayer, urlHash: row.params.urlHash, payoutWallet: row.params.payoutWallet,
      authorsHash: keccak256(encodeAbiParameters([{ type: "tuple[]", components: [{ name: "wallet", type: "address" },
        { name: "basisPoints", type: "uint16" }] }], [row.params.authors])),
      fetchPriceUsdc6: BigInt(row.params.fetchPriceUsdc6), contentCidHash: keccak256(toBytes(row.params.contentCid)),
      tagsHash: keccak256(toBytes(row.params.tags)), nonce: BigInt(row.nonce), deadline: BigInt(row.deadline),
    } };
}
export const registrationPolicyDigest = (policy: RegistrationSponsorPolicy): Hex => keccak256(toBytes(canonicalJson(registrationSponsorPolicySchema.parse(policy))));
export const registrationIntentDigest = (row: SponsoredRegistration): Hex => hashTypedData(registrationTypedData(row));
export const REGISTRATION_SPONSOR_ABI = [
  { type: "function", name: "registryVersion", stateMutability: "pure", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "registrationNonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "registerWithSignature", stateMutability: "nonpayable", inputs: [
    { name: "request", type: "tuple", components: [
      { name: "creator", type: "address" }, { name: "relayer", type: "address" }, { name: "urlHash", type: "bytes32" },
      { name: "payoutWallet", type: "address" }, { name: "authors", type: "tuple[]", components: [
        { name: "wallet", type: "address" }, { name: "basisPoints", type: "uint16" }] },
      { name: "fetchPriceUsdc6", type: "uint64" }, { name: "contentCid", type: "string" }, { name: "tags", type: "string" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint64" },
    ] }, { name: "signature", type: "bytes" },
  ], outputs: [] },
] as const;
export function registrationContractRequest(row: SponsoredRegistration) {
  return { creator: row.creator, relayer: row.relayer, ...row.params,
    fetchPriceUsdc6: BigInt(row.params.fetchPriceUsdc6), nonce: BigInt(row.nonce), deadline: BigInt(row.deadline) };
}
