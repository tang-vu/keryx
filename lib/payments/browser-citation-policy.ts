import { z } from "zod";
import {
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  type Hex,
} from "viem";
import { canonicalJson } from "../canonical-json";
import {
  BROWSER_SIGNING_SERVICE,
  browserQueryPolicySchema,
  verifyBrowserQueryPolicy,
} from "./browser-query-policy";

const digest = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value as Hex);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase() as Hex);
const integer = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})$/)
  .refine((value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER));
export const browserCitationPolicySchema = z
  .object({
    version: z.literal("citation-policy-v1"),
    service: z.literal(BROWSER_SIGNING_SERVICE),
    owner: address,
    signer: address,
    namespace: digest,
    queryId: z.string().uuid(),
    queryPolicyProofDigest: digest,
    questionDigest: digest,
    grantEpoch: z.string().uuid(),
    supplementNonce: digest,
    runBudgetMicros: integer,
    poolNumerator: integer,
    poolDenominator: integer.refine((value) => BigInt(value) > BigInt(0)),
    poolRounding: z.literal("nearest-half-up"),
    maximumPoolMicros: integer,
    allocationAlgorithmDigest: digest,
    evidenceAlgorithmDigest: digest,
    trustedIssuerDigest: digest,
    authorityPolicyDigest: digest,
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(
    (value) => BigInt(value.poolNumerator) <= BigInt(value.poolDenominator)
  );
export type BrowserCitationPolicy = z.infer<typeof browserCitationPolicySchema>;
const proofSchema = z
  .object({
    policy: browserCitationPolicySchema,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();
const queryProofSchema = z
  .object({
    policy: browserQueryPolicySchema,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();
export const browserCitationTrustedPolicySchema = z
  .object({
    allocationAlgorithmDigest: digest,
    evidenceAlgorithmDigest: digest,
    trustedIssuerDigest: digest,
    authorityPolicyDigest: digest,
  })
  .strict();
export type BrowserCitationTrustedPolicy = z.infer<
  typeof browserCitationTrustedPolicySchema
>;
const fields = [
  { name: "version", type: "string" },
  { name: "service", type: "string" },
  { name: "owner", type: "address" },
  { name: "signer", type: "address" },
  { name: "namespace", type: "bytes32" },
  { name: "queryId", type: "string" },
  { name: "queryPolicyProofDigest", type: "bytes32" },
  { name: "questionDigest", type: "bytes32" },
  { name: "grantEpoch", type: "string" },
  { name: "supplementNonce", type: "bytes32" },
  { name: "runBudgetMicros", type: "uint256" },
  { name: "poolNumerator", type: "uint256" },
  { name: "poolDenominator", type: "uint256" },
  { name: "poolRounding", type: "string" },
  { name: "maximumPoolMicros", type: "uint256" },
  { name: "allocationAlgorithmDigest", type: "bytes32" },
  { name: "evidenceAlgorithmDigest", type: "bytes32" },
  { name: "trustedIssuerDigest", type: "bytes32" },
  { name: "authorityPolicyDigest", type: "bytes32" },
  { name: "expiresAt", type: "uint256" },
] as const;
export function browserCitationPolicyTypedData(value: BrowserCitationPolicy) {
  const policy = browserCitationPolicySchema.parse(value);
  return {
    domain: {
      name: "KeryxBrowserCitationPolicy",
      version: "1",
      chainId: 5042002,
      salt: keccak256(stringToHex(BROWSER_SIGNING_SERVICE)),
    },
    types: {
      CitationPolicy: fields,
    },
    primaryType: "CitationPolicy" as const,
    message: {
      ...policy,
      runBudgetMicros: BigInt(policy.runBudgetMicros),
      poolNumerator: BigInt(policy.poolNumerator),
      poolDenominator: BigInt(policy.poolDenominator),
      maximumPoolMicros: BigInt(policy.maximumPoolMicros),
      expiresAt: BigInt(policy.expiresAt),
    },
  };
}
export function computeBrowserCitationPoolMicros(
  value: BrowserCitationPolicy
): string {
  const policy = browserCitationPolicySchema.parse(value);
  const numerator =
    BigInt(policy.runBudgetMicros) * BigInt(policy.poolNumerator);
  const denominator = BigInt(policy.poolDenominator);
  const result =
    (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
  if (result > BigInt(policy.maximumPoolMicros))
    throw new Error("Citation policy refused");
  return result.toString();
}
declare const verifiedCitationPolicy: unique symbol;
export type VerifiedBrowserCitationPolicy = {
  readonly [verifiedCitationPolicy]: true;
};
const tokens = new WeakMap<
  object,
  Readonly<{
    policy: Readonly<BrowserCitationPolicy>;
    signature: Hex;
    proofDigest: string;
    verifiedAtMs: number;
    poolMicros: string;
  }>
>();
/** Pure owner proof only: current grant, payment admission and private artifact access remain downstream requirements. */
export async function verifyBrowserCitationPolicy(
  value: unknown,
  retainedQueryProof: unknown,
  trustedPolicy: BrowserCitationTrustedPolicy,
  trustedNow: () => number
): Promise<VerifiedBrowserCitationPolicy> {
  const started = performance.now();
  const nowMs = trustedNow();
  const proof = proofSchema.parse(value);
  const queryProof = queryProofSchema.parse(retainedQueryProof);
  const trusted = browserCitationTrustedPolicySchema.parse(trustedPolicy);
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    proof.policy.expiresAt <= nowMs ||
    new TextEncoder().encode(canonicalJson(proof)).length > 4096
  )
    throw new Error("Citation policy refused");
  const query = await verifyBrowserQueryPolicy(queryProof);
  const policy = proof.policy;
  if (
    policy.owner !== query.policy.owner ||
    policy.signer !== query.policy.signer ||
    policy.namespace !== query.namespace ||
    policy.queryId !== query.policy.queryId ||
    policy.grantEpoch !== query.policy.grantEpoch ||
    policy.questionDigest !== query.policy.questionDigest ||
    policy.queryPolicyProofDigest !== query.proofDigest ||
    policy.expiresAt <= nowMs ||
    policy.expiresAt > query.policy.expiresAt ||
    BigInt(policy.runBudgetMicros) > BigInt(query.policy.queryCeilingMicros)
  )
    throw new Error("Citation policy refused");
  for (const field of Object.keys(
    trusted
  ) as (keyof BrowserCitationTrustedPolicy)[])
    if (policy[field] !== trusted[field])
      throw new Error("Citation policy refused");
  const poolMicros = computeBrowserCitationPoolMicros(policy);
  const recovered = await recoverTypedDataAddress({
    ...browserCitationPolicyTypedData(policy),
    signature: proof.signature as Hex,
  });
  if (recovered.toLowerCase() !== policy.owner)
    throw new Error("Citation policy refused");
  const finishedAt = trustedNow();
  const elapsed = performance.now() - started;
  if (
    !Number.isSafeInteger(finishedAt) ||
    finishedAt < nowMs ||
    policy.expiresAt <= finishedAt ||
    elapsed < 0 ||
    elapsed > 5000
  )
    throw new Error("Citation policy refused");
  const token = Object.freeze({}) as VerifiedBrowserCitationPolicy;
  tokens.set(
    token,
    Object.freeze({
      policy: Object.freeze(policy),
      signature: proof.signature.toLowerCase() as Hex,
      proofDigest: keccak256(stringToHex(canonicalJson(policy))),
      verifiedAtMs: finishedAt,
      poolMicros,
    })
  );
  return token;
}
export function unsealVerifiedBrowserCitationPolicy(
  token: VerifiedBrowserCitationPolicy,
  nowMs: number
) {
  const proof = tokens.get(token);
  if (
    !proof ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < proof.verifiedAtMs ||
    proof.policy.expiresAt <= nowMs
  )
    throw new Error("Citation policy refused");
  return proof;
}
