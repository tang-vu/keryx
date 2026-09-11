import { z } from "zod";
import { hashTypedData, maxUint256, recoverTypedDataAddress, type Hex } from "viem";

/** Same EIP-712 fields as the installed Circle Gateway SDK. No secret/config imports. */
export const WITHDRAW_TYPES = {
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
export const WITHDRAW_DOMAIN = { name: "GatewayWallet", version: "1" } as const;
const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
  .pipe(z.string().refine(value => BigInt(value) <= maxUint256));
const hex32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase() as Hex);
const paddedAddress = z.string().regex(/^0x0{24}[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform(value => value.toLowerCase() as Hex);
const uint32 = z.number().int().min(0).max(0xffffffff);
export const withdrawRequestSchema = z.object({
  burnIntent: z.object({
    maxBlockHeight: uint, maxFee: uint,
    spec: z.object({
      version: z.literal(1), sourceDomain: uint32, destinationDomain: uint32,
      sourceContract: paddedAddress, destinationContract: paddedAddress,
      sourceToken: paddedAddress, destinationToken: paddedAddress,
      sourceDepositor: paddedAddress, destinationRecipient: paddedAddress,
      sourceSigner: paddedAddress, destinationCaller: paddedAddress,
      value: uint.pipe(z.string().refine(value => BigInt(value) > BigInt(0))), salt: hex32,
      hookData: z.literal("0x"),
    }).strict(),
  }).strict(),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/).transform(value => value.toLowerCase() as Hex),
}).strict();
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

export const withdrawPolicySchema = z.object({
  owner: address, recipient: address, domain: uint32,
  gatewayWallet: address, gatewayMinter: address, asset: address,
  maxValueMicros: uint, maxFeeMicros: uint,
}).strict();
export type WithdrawPolicy = z.infer<typeof withdrawPolicySchema>;

export function withdrawTypedData(intent: WithdrawRequest["burnIntent"]) {
  return { domain: WITHDRAW_DOMAIN, types: WITHDRAW_TYPES, primaryType: "BurnIntent" as const,
    message: { maxBlockHeight: BigInt(intent.maxBlockHeight), maxFee: BigInt(intent.maxFee),
      spec: { ...intent.spec, value: BigInt(intent.spec.value) } } };
}

/** Validated request snapshot for later durable admission. This grants no permission
 * to submit, retry, mint or report settlement. ID is the BurnIntent EIP-712 digest,
 * NOT Circle's transfer ID or TransferSpec hash. The caller authenticates policy.owner. */
export async function verifyWithdrawRequest(value: unknown, selectedPolicy: WithdrawPolicy) {
  try {
    // Snapshot caller-owned objects before the first asynchronous signature check.
    const request = withdrawRequestSchema.parse(value), policy = withdrawPolicySchema.parse(selectedPolicy);
    const { spec } = request.burnIntent;
    const b32 = (value: string) => `0x${"0".repeat(24)}${value.slice(2)}`;
    if (spec.sourceDomain !== policy.domain || spec.destinationDomain !== policy.domain
      || spec.sourceContract !== b32(policy.gatewayWallet) || spec.destinationContract !== b32(policy.gatewayMinter)
      || spec.sourceToken !== b32(policy.asset) || spec.destinationToken !== b32(policy.asset)
      || spec.sourceDepositor !== b32(policy.owner) || spec.sourceSigner !== b32(policy.owner)
      || spec.destinationRecipient !== b32(policy.recipient) || spec.destinationCaller !== `0x${"0".repeat(64)}`
      || BigInt(spec.value) > BigInt(policy.maxValueMicros)
      || BigInt(request.burnIntent.maxFee) > BigInt(policy.maxFeeMicros)) throw new Error();
    const typed = withdrawTypedData(request.burnIntent);
    const signer = await recoverTypedDataAddress({ ...typed, signature: request.signature });
    if (signer.toLowerCase() !== policy.owner) throw new Error();
    return { id: hashTypedData(typed), owner: policy.owner, recipient: policy.recipient, request };
  } catch { throw new Error("Withdrawal authorization unavailable"); }
}
