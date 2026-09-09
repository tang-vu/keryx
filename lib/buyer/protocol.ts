import { z } from "zod";
import { AskQuestionSchema } from "../ask-input";

export const BUYER_ORIGIN = "https://keryx.cc";
export const BUYER_ENDPOINT = `${BUYER_ORIGIN}/api/agent/ask`;
export const BUYER_NETWORK = "eip155:5042002";
export const BUYER_USDC = "0x3600000000000000000000000000000000000000";
export const BUYER_GATEWAY = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export class BuyerRefusal extends Error {}
export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine((v) => !/^0x0{40}$/.test(v));
const atomic = z.string().regex(/^[1-9]\d{0,6}$/);
export const buyerRequestSchema = z.object({
  question: AskQuestionSchema,
  budget: z.number().finite().positive().max(0.5).refine((n) => Math.abs(n * 1e6 - Math.round(n * 1e6)) < 1e-8),
  researchMode: z.enum(["quick", "deep"]),
  packageVersion: z.literal("1.0.0"),
  responseMode: z.literal("async"),
}).strict();
export type BuyerRequest = z.infer<typeof buyerRequestSchema>;
export const requirementSchema = z.object({
  scheme: z.literal("exact"), network: z.literal(BUYER_NETWORK),
  asset: addressSchema.refine((v) => v.toLowerCase() === BUYER_USDC.toLowerCase()),
  amount: atomic, payTo: addressSchema,
  maxTimeoutSeconds: z.number().int().min(604860).max(691200),
  extra: z.object({
    name: z.literal("GatewayWalletBatched"), version: z.literal("1"),
    verifyingContract: addressSchema.refine((v) => v.toLowerCase() === BUYER_GATEWAY.toLowerCase()),
  }).strict(),
}).strict();
export type BuyerRequirement = z.infer<typeof requirementSchema>;

export function decodeHeader(value: string | null): unknown {
  if (!value || value.length > 65536 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid payment header");
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
}

export function chooseRequirement(header: string | null, request: BuyerRequest, payee: string, maxTotalMicros: string): BuyerRequirement {
  request = buyerRequestSchema.parse(request);
  addressSchema.parse(payee);
  const limit = BigInt(atomic.parse(maxTotalMicros));
  if (limit > BigInt(1_000_000)) throw new Error("Buyer limit is at most 1 testnet USDC per job");
  const challenge = z.object({
    x402Version: z.literal(2), resource: z.object({ url: z.string() }),
    accepts: z.array(z.unknown()).min(1).max(16),
  }).parse(decodeHeader(header));
  if (![BUYER_ENDPOINT, "/api/agent/ask"].includes(challenge.resource.url)) throw new Error("Wrong paid resource");
  const options = challenge.accepts.flatMap((value) => {
    const parsed = requirementSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).filter((value) => value.payTo.toLowerCase() === payee.toLowerCase()
    && BigInt(value.amount) <= limit && BigInt(value.amount) > BigInt(Math.round(request.budget * 1e6)));
  if (options.length !== 1) throw new Error("SKIP: no unique payment option matches network, token, payee, domain and total-price limit");
  return options[0];
}

export const authorizationSchema = z.object({
  from: addressSchema, to: addressSchema, value: atomic,
  validAfter: z.string().regex(/^\d+$/), validBefore: z.string().regex(/^\d+$/),
  nonce: z.string().regex(/^0x[a-f0-9]{64}$/),
}).strict();
export type BuyerAuthorization = z.infer<typeof authorizationSchema>;

/** Structural envelope only. Each runtime must also recompute and check the job ID. */
export const buyerIntentEnvelopeSchema = z.object({
  schema: z.literal("keryx-buyer-intent-v1"),
  request: buyerRequestSchema,
  requirement: requirementSchema,
  authorization: authorizationSchema,
  queryId: z.string(),
}).strict();
export type BuyerIntentEnvelope = z.infer<typeof buyerIntentEnvelopeSchema>;

export function authorizationWithNonce(payer: string, requirement: BuyerRequirement, nonce: string, now = Date.now()): BuyerAuthorization {
  requirementSchema.parse(requirement);
  if (!Number.isSafeInteger(now) || now < 600_000) throw new Error("Invalid authorization time");
  return authorizationSchema.parse({
    from: payer, to: requirement.payTo, value: requirement.amount,
    validAfter: String(Math.floor(now / 1000) - 600),
    validBefore: String(Math.floor(now / 1000) + requirement.maxTimeoutSeconds),
    nonce,
  });
}

/** Mirrors Circle batching's EIP-3009 domain, pinned to Arc testnet by policy. */
export function buyerTypedData(a: BuyerAuthorization) {
  return {
    domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: BUYER_GATEWAY as `0x${string}` },
    types: { TransferWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "TransferWithAuthorization",
    message: { from: a.from as `0x${string}`, to: a.to as `0x${string}`, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as `0x${string}` },
  } as const;
}
