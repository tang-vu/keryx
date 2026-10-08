import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";
import { canonicalSourceUrl } from "../sources/public-source-claim";

export const OPERATING_FEE_SOURCE_ID = "keryx:operating-fee";
export const OPERATING_FEE_POLICY_KEY_PREFIX = "keryx:operating-fee:v1:policy:";
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(value => !/^0x0{40}$/.test(value));
const positiveMicros = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
const sourceUrl = z.string().max(2048).refine(value => {
  try { return canonicalSourceUrl(value) === value; } catch { return false; }
}, "Exact canonical credential-free HTTPS source URL required");
export const operatingFeeContextSchema = z.object({
  policyDigest: digest, allocationDigest: digest, amountMicroUsdc: positiveMicros,
  sourceUrls: z.array(sourceUrl).min(1).max(32).refine(urls => new Set(urls).size === urls.length)
    .refine(urls => Buffer.byteLength(canonicalJson(urls)) <= 4096, "Operating fee source identity limit exceeded"),
}).strict();
export type OperatingFeeContext = Readonly<z.infer<typeof operatingFeeContextSchema>>;

/** Operator-reviewed recipient authority, separate from creator/source ownership. */
export const operatingFeePolicySchema = z.object({
  format: z.literal("keryx-operating-fee-policy-v1"), network: z.literal("eip155:5042"),
  origin: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  }),
  storageIdentityDigest: digest, beneficiary: address,
  expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type OperatingFeePolicy = Readonly<z.infer<typeof operatingFeePolicySchema>>;

export function operatingFeePolicyDigest(policy: OperatingFeePolicy): string {
  return createHash("sha256").update(canonicalJson(operatingFeePolicySchema.parse(policy))).digest("hex");
}

export function validateOperatingFeePolicy(value: unknown, identity: StorageIdentity, origin: string, treasurySigner: string): OperatingFeePolicy {
  const policy = operatingFeePolicySchema.parse(value), storage = validateStorageIdentity(identity);
  if (storage.authorityMode !== "mainnet-real" || storage.network !== ARC_MAINNET_PROFILE.networkId ||
      policy.storageIdentityDigest !== storageIdentityDigest(storage) || policy.origin !== origin ||
      policy.beneficiary === address.parse(treasurySigner) || policy.expiresAtSeconds <= Math.floor(Date.now() / 1000))
    throw new Error("Operating fee policy unavailable");
  return Object.freeze(policy);
}

/** Fresh protected configuration, never a request-selected wallet or an implicit fallback. */
export function configuredOperatingFeePolicy(identity: StorageIdentity, origin: string, treasurySigner: string): OperatingFeePolicy {
  const text = process.env.KERYX_OPERATING_FEE_POLICY_JSON, expectedDigest = process.env.KERYX_OPERATING_FEE_POLICY_DIGEST;
  if (!text || Buffer.byteLength(text) > 4096 || !expectedDigest || !digest.safeParse(expectedDigest).success)
    throw new Error("Operating fee reviewed policy unavailable");
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("Operating fee reviewed policy unavailable"); }
  const policy = validateOperatingFeePolicy(value, identity, origin, treasurySigner);
  if (text !== canonicalJson(policy) || operatingFeePolicyDigest(policy) !== expectedDigest)
    throw new Error("Operating fee reviewed policy unavailable");
  return policy;
}

/** The existing 50% citation pool is a ceiling; no fee can increase the query budget. */
export function operatingFeeMaxMicroUsdc(queryBudgetMicroUsdc: string): string {
  return (BigInt(positiveMicros.parse(queryBudgetMicroUsdc)) / BigInt(2)).toString();
}

/** The resource hash binds the submitted original to its query and exact allocation terms. */
export function operatingFeeEndpointPath(queryId: string, fee: Pick<OperatingFeeContext, "policyDigest" | "allocationDigest" | "amountMicroUsdc">): string {
  z.string().min(1).max(256).parse(queryId);
  digest.parse(fee.policyDigest); digest.parse(fee.allocationDigest); positiveMicros.parse(fee.amountMicroUsdc);
  return "/api/research/operating-fee?" + new URLSearchParams({ query: queryId, amount: fee.amountMicroUsdc,
    policy: fee.policyDigest, allocation: fee.allocationDigest }).toString();
}
export function operatingFeeRequestHash(queryId: string, fee: Pick<OperatingFeeContext, "policyDigest" | "allocationDigest" | "amountMicroUsdc">): string {
  return createHash("sha256").update(operatingFeeEndpointPath(queryId, fee)).digest("hex");
}
