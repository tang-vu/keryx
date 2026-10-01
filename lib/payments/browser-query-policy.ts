import { z } from "zod";
import {
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  type Hex,
} from "viem";
import { canonicalJson } from "../canonical-json";

export const BROWSER_SIGNING_SERVICE = "https://keryx.cc";
export const BROWSER_SIGNING_PROTOCOL = "durable-v2";
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase() as Hex);
const digest = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value as Hex);
const micros = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
export const browserQueryPolicySchema = z
  .object({
    protocol: z.literal(BROWSER_SIGNING_PROTOCOL),
    service: z.literal(BROWSER_SIGNING_SERVICE),
    owner: address,
    signer: address,
    policyId: digest,
    grantEpoch: z.string().uuid(),
    requestNonce: digest,
    queryId: z.string().uuid(),
    questionDigest: digest,
    queryCeilingMicros: micros,
    lifetimeCeilingMicros: micros,
    jobLimit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(
    (value) =>
      BigInt(value.queryCeilingMicros) <= BigInt(value.lifetimeCeilingMicros)
  );
export type BrowserQueryPolicy = z.infer<typeof browserQueryPolicySchema>;
export interface BrowserQueryPolicyProof {
  policy: BrowserQueryPolicy;
  signature: Hex;
}
export interface VerifiedBrowserQueryPolicy extends BrowserQueryPolicyProof {
  namespace: string;
  proofDigest: string;
}
const fields = [
  { name: "protocol", type: "string" },
  { name: "service", type: "string" },
  { name: "owner", type: "address" },
  { name: "signer", type: "address" },
  { name: "policyId", type: "bytes32" },
  { name: "grantEpoch", type: "string" },
  { name: "requestNonce", type: "bytes32" },
  { name: "queryId", type: "string" },
  { name: "questionDigest", type: "bytes32" },
  { name: "queryCeilingMicros", type: "uint256" },
  { name: "lifetimeCeilingMicros", type: "uint256" },
  { name: "jobLimit", type: "uint256" },
  { name: "expiresAt", type: "uint256" },
] as const;
export function browserQueryPolicyTypedData(policy: BrowserQueryPolicy) {
  const parsed = browserQueryPolicySchema.parse(policy);
  return {
    domain: {
      name: "KeryxBrowserQueryPolicy",
      version: "2",
      chainId: 5042002,
      salt: keccak256(stringToHex(BROWSER_SIGNING_SERVICE)),
    },
    types: { QueryPolicy: fields },
    primaryType: "QueryPolicy" as const,
    message: {
      ...parsed,
      queryCeilingMicros: BigInt(parsed.queryCeilingMicros),
      lifetimeCeilingMicros: BigInt(parsed.lifetimeCeilingMicros),
      jobLimit: BigInt(parsed.jobLimit),
      expiresAt: BigInt(parsed.expiresAt),
    },
  };
}
/** Actual owner proof, not a caller assertion. Privileged backend composition remains trusted. */
export async function verifyBrowserQueryPolicy(
  value: unknown
): Promise<VerifiedBrowserQueryPolicy> {
  const proof = z
    .object({
      policy: browserQueryPolicySchema,
      signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    })
    .strict()
    .parse(value);
  const signature = proof.signature.toLowerCase() as Hex;
  const recovered = await recoverTypedDataAddress({
    ...browserQueryPolicyTypedData(proof.policy),
    signature,
  });
  if (recovered.toLowerCase() !== proof.policy.owner)
    throw new Error("Browser query policy owner proof refused");
  const namespace = keccak256(
    stringToHex(
      canonicalJson([
        proof.policy.service,
        "eip155:5042002",
        proof.policy.owner,
        proof.policy.signer,
      ])
    )
  );
  const proofDigest = keccak256(stringToHex(canonicalJson(proof.policy)));
  return Object.freeze({
    policy: Object.freeze(proof.policy),
    signature,
    namespace,
    proofDigest,
  });
}
