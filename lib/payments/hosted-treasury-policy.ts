import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";

const micros = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(v => BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER));
export const hostedTreasuryPolicySchema = z.object({
  format: z.literal("keryx-hosted-treasury-policy-v1"), network: z.literal("eip155:5042"),
  storageIdentityDigest: z.string().regex(/^[0-9a-f]{64}$/),
  origin: z.string().url().refine(v => { const u = new URL(v); return u.protocol === "https:" && u.origin === v && !u.username && !u.password; }),
  signer: z.string().regex(/^0x[0-9a-f]{40}$/).refine(v => !/^0x0{40}$/.test(v)),
  lifetimeCapMicroUsdc: micros, queryCapMicroUsdc: micros,
  expiresAtSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict().refine(p => BigInt(p.queryCapMicroUsdc) <= BigInt(p.lifetimeCapMicroUsdc));
export type HostedTreasuryPolicy = z.infer<typeof hostedTreasuryPolicySchema>;
export function hostedTreasuryPolicyDigest(value: HostedTreasuryPolicy) {
  return createHash("sha256").update(canonicalJson(hostedTreasuryPolicySchema.parse(value))).digest("hex");
}
export function validateHostedTreasuryPolicy(value: unknown, identity: StorageIdentity, origin?: string) {
  const p = hostedTreasuryPolicySchema.parse(value), s = validateStorageIdentity(identity);
  if (s.authorityMode !== "mainnet-real" || s.network !== ARC_MAINNET_PROFILE.networkId ||
    p.storageIdentityDigest !== storageIdentityDigest(s) || origin !== undefined && p.origin !== origin)
    throw new Error("Hosted treasury policy identity refused");
  return p;
}
/** Protected operator configuration is the authority, never request parameters.
 * No key is read here. An absent reviewed policy leaves this role closed. */
export function configuredHostedTreasuryPolicy(identity: StorageIdentity, origin: string, role: "public" | "private" = "public") {
  const prefix = role === "private" ? "KERYX_MAINNET_PRIVATE_TREASURY" : "KERYX_MAINNET_TREASURY";
  const text = process.env[`${prefix}_POLICY_JSON`], digest = process.env[`${prefix}_POLICY_DIGEST`];
  if (!text || Buffer.byteLength(text) > 4096 || !digest || !/^[0-9a-f]{64}$/.test(digest))
    throw new Error("Hosted treasury reviewed policy unavailable");
  let input; try { input = JSON.parse(text); } catch { throw new Error("Hosted treasury reviewed policy unavailable"); }
  const p = validateHostedTreasuryPolicy(input, identity, origin);
  if (text !== canonicalJson(p) || hostedTreasuryPolicyDigest(p) !== digest || p.expiresAtSeconds <= Math.floor(Date.now() / 1000))
    throw new Error("Hosted treasury reviewed policy unavailable");
  return Object.freeze(p);
}
